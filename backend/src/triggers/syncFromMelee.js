import { MeleeClient } from '../lib/melee.js';
import { getSettings, updateSettingsBatch, parseSeasonId, parseWeek, isSeasonStarted, isSeasonPaused, isVotingOpen } from '../db/queries.js';
import { computeSchemer, computeAmbassador, computeChampion, computeBountyHunter, computeNewHopeClimbers, writePodiumBlock } from '../lib/awards.js';
import { fetchLeagueTournaments, buildWeekMap } from '../lib/meleeLeague.js';
import { syncSeasonData } from '../lib/leagueSync.js';
import { computeSeasonTable } from '../lib/seasonTable.js';
import { AWARD, PHASE, SETTINGS_KEY, SEASON_ENDED_WEEK, WEEK_PREFIX, SET_TRUE, SET_FALSE, DEFAULT_TOP_RESULTS, DEFAULT_SEASON_LENGTH, GATE_WEEKDAY, GATE_MINUTES, PRIMARY_CUTOFF_MINUTES } from '../lib/constants.js';

function stockholmTimeParts(isoNow) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Stockholm',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(new Date(isoNow));
  const part = type => parts.find(p => p.type === type)?.value ?? '';
  return {
    weekday: part('weekday'),
    minutes: Number(part('hour')) * 60 + Number(part('minute')),
  };
}

// League-night fire slots are DST-symmetric: crons at 20:15/21:15/22:15 UTC
// guarantee exactly two time-gate-eligible fires per Wednesday, landing at
// 22:15 and 23:15 Stockholm in both CEST and CET. The first eligible fire
// (primary) may defer lifecycle moves while the week's data is unpublished;
// the second always acts, so a week can never be lost to late publishing.
export function isPrimaryFire(isoNow) {
  return stockholmTimeParts(isoNow).minutes < PRIMARY_CUTOFF_MINUTES;
}

export function shouldAdvance(isoNow, marker) {
  const { weekday, minutes } = stockholmTimeParts(isoNow);
  const isLeagueNight = weekday === GATE_WEEKDAY;
  const isLateEnough = minutes >= GATE_MINUTES;
  const today = isoNow.split('T')[0];
  const notYetAdvanced = marker !== today;
  return isLeagueNight && isLateEnough && notYetAdvanced;
}

export async function syncFromMelee(env, deps = {}) {
  const { DB } = env;
  const ClientClass = deps.MeleeClient || MeleeClient;
  const now = deps.now || new Date().toISOString();

  console.log('[SyncFromMelee] Starting weekly sync...');

  const settings = await getSettings(DB);
  const seasonStarted = isSeasonStarted(settings.SEASON_STARTED);
  const seasonEnded = !seasonStarted;
  const activeSeasonId = parseSeasonId(settings.ACTIVE_SEASON_ID);
  const currentWeek = parseWeek(settings.CURRENT_WEEK);
  const votingOpen = isVotingOpen(settings.VOTING_OPEN);
  const isPaused = isSeasonPaused(settings.SEASON_PAUSED);
  const lastAdvanced = settings.LAST_ADVANCED || '';

  if (!activeSeasonId) {
    console.log('[SyncFromMelee] No active season; skipping.');
    return { status: 'skipped', reason: 'no-active-season' };
  }

  const clientId = env.MELEE_CLIENT_ID || '';
  const clientSecret = env.MELEE_CLIENT_SECRET || '';
  const client = new ClientClass(clientId, clientSecret);

  const storedTournaments = await DB.prepare(
    'SELECT melee_id, round FROM melee_tournaments WHERE season_id = ?'
  ).bind(activeSeasonId).all();
  const existingRoundMap = new Map((storedTournaments.results || []).map(t => [t.melee_id, t.round]));

  let matchedTournaments;
  try {
    matchedTournaments = await fetchLeagueTournaments(client, { targetSeason: activeSeasonId });
  } catch (err) {
    console.error(`[SyncFromMelee] Tournament list fetch failed; aborting before any changes: ${err.message}`);
    return { status: 'fetch-failed', error: err.message };
  }

  const season = await DB.prepare('SELECT length, top_results FROM seasons WHERE id = ?').bind(activeSeasonId).first();
  const seasonLength = season?.length || DEFAULT_SEASON_LENGTH;
  const topResults = season?.top_results || DEFAULT_TOP_RESULTS;

  const weekMap = buildWeekMap(matchedTournaments, existingRoundMap);

  const engineResult = await syncSeasonData(DB, client, {
    seasonId: activeSeasonId,
    weekMap,
    budget: Infinity,
    reactivate: true,
    auditVotes: true,
    logPrefix: '[SyncFromMelee]',
  });

  if (engineResult.createdPlayers.length > 0) {
    console.log(`[SyncFromMelee] Auto-created ${engineResult.createdPlayers.length} player(s) from Melee data: ${engineResult.createdPlayers.map(p => `${p.id} (${p.melee_name})`).join(', ')}`);
  }

  if (isPaused) {
    console.log('[SyncFromMelee] Season paused; data synced, skipping advance/open/close.');
    console.log('[SyncFromMelee] Sync complete.');
    return { status: 'paused', syncedTournaments: weekMap.size };
  }

  if (seasonEnded) {
    const championRow = await DB.prepare(
      "SELECT 1 FROM awards WHERE season_id = ? AND award_name = ? AND player_id != '' LIMIT 1"
    ).bind(activeSeasonId, AWARD.CHAMPION).first();
    if (!championRow) {
      const champion = await computeChampion(DB, activeSeasonId);
      if (champion.length > 0) {
        await writePodiumBlock(DB, activeSeasonId, AWARD.CHAMPION, champion);
        console.log('[SyncFromMelee] Post-close: Galactic Champion materialized.');
      }
    }
    return { status: 'post-close-sync', syncedTournaments: weekMap.size };
  }

  const schemer = await computeSchemer(DB, activeSeasonId);
  if (schemer.length > 0) {
    await writePodiumBlock(DB, activeSeasonId, AWARD.SCHEMER, schemer);
  }

  const ambassador = await computeAmbassador(DB, activeSeasonId);
  if (ambassador.length > 0) {
    await writePodiumBlock(DB, activeSeasonId, AWARD.AMBASSADOR, ambassador);
  }

  const bountyHunter = await computeBountyHunter(DB, activeSeasonId);
  if (bountyHunter.length > 0) {
    await writePodiumBlock(DB, activeSeasonId, AWARD.BOUNTY_HUNTER, bountyHunter);
  }

  const regularRounds = await DB.prepare(`
    SELECT DISTINCT round FROM melee_tournaments WHERE season_id = ? AND phase = ?
  `).bind(activeSeasonId, PHASE.REGULAR).all();
  const regularRoundSet = new Set((regularRounds.results || []).map(r => r.round));

  const allStandings = await DB.prepare(
    'SELECT round, player_id, wins, losses, draws, match_points, rank FROM season_standings WHERE season_id = ?'
  ).bind(activeSeasonId).all();

  const nights = (allStandings.results || [])
    .filter(s => regularRoundSet.has(s.round))
    .map(s => ({
      playerId: s.player_id,
      round: s.round,
      wins: s.wins || 0,
      draws: s.draws || 0,
      losses: s.losses || 0,
      rank: s.rank,
    }));

  const seasonTable = computeSeasonTable(nights, topResults);

  const rulerEntries = seasonTable
    .filter(r => r.rank <= 3)
    .map(r => ({ playerId: r.playerId, score: r.points, name: '', rank: r.rank }));

  if (rulerEntries.length > 0) {
    await writePodiumBlock(DB, activeSeasonId, AWARD.RULER, rulerEntries);
  }

  const finalRankMap = new Map(seasonTable.map(r => [r.playerId, r.rank]));

  const climbers = await computeNewHopeClimbers(DB, activeSeasonId, finalRankMap, seasonLength);

  if (climbers.length > 0) {
    await writePodiumBlock(DB, activeSeasonId, AWARD.NEW_HOPE, climbers.map(c => ({
      playerId: c.playerId, score: c.climb, name: '',
    })));
  }

  // P3: extract this lifecycle tail into runLifecycle() after the first
  // automatic WED-cycle (2026-10-07) logs are reviewed — see AGENTS.md follow-ups.
  const fresh = await getSettings(DB);
  if ((fresh.LAST_ADVANCED || '') !== lastAdvanced || isVotingOpen(fresh.VOTING_OPEN) !== votingOpen) {
    console.warn('[SyncFromMelee] Race guard: lifecycle settings changed during this run (concurrent sync?); skipping advance.');
    return { status: 'synced-no-advance', reason: 'race-guard' };
  }

  const today = now.split('T')[0];
  const canAdvance = shouldAdvance(now, lastAdvanced);

  const attendedRounds = await DB.prepare(
    'SELECT DISTINCT week FROM attendance WHERE season_id = ?'
  ).bind(activeSeasonId).all();
  const latestRegularAttended = (attendedRounds.results || [])
    .filter(r => regularRoundSet.has(r.week))
    .reduce((m, r) => Math.max(m, r.week), 0);

  let weekDataPresent = false;
  if (currentWeek) {
    const weekRow = await DB.prepare(
      'SELECT 1 FROM attendance WHERE season_id = ? AND week = ? LIMIT 1'
    ).bind(activeSeasonId, currentWeek).first();
    weekDataPresent = !!weekRow;
  }

  if (!votingOpen) {
    if (canAdvance && isPrimaryFire(now) && !weekDataPresent) {
      console.log('[SyncFromMelee] Try-1 first run with no week data; deferring open to the retry fire.');
      return { status: 'synced-deferred', action: 'open', targetWeek: currentWeek };
    }
    if (canAdvance || weekDataPresent) {
      await updateSettingsBatch(DB, [[SETTINGS_KEY.VOTING_OPEN, SET_TRUE], [SETTINGS_KEY.LAST_ADVANCED, today]]);
      console.log(canAdvance
        ? '[SyncFromMelee] First run — voting opened.'
        : '[SyncFromMelee] Week data present — voting opened by retry fire.');
      return { status: 'voting-opened' };
    }
  } else if (canAdvance) {
    const nextWeek = Math.max((currentWeek || 0) + 1, latestRegularAttended);
    if (nextWeek > seasonLength) {
      const champion = await computeChampion(DB, activeSeasonId);
      if (champion.length > 0) {
        await writePodiumBlock(DB, activeSeasonId, AWARD.CHAMPION, champion);
      }
      await updateSettingsBatch(DB, [[SETTINGS_KEY.CURRENT_WEEK, SEASON_ENDED_WEEK], [SETTINGS_KEY.VOTING_OPEN, SET_FALSE], [SETTINGS_KEY.SEASON_STARTED, SET_FALSE]]);
      console.log('[SyncFromMelee] Season ended.');
      return { status: 'season-ended' };
    }
    // The just-played night counts as data only once a round beyond the open
    // week has attendance. Close decisions above never defer: their target is
    // a cut round, which produces no regular attendance by definition.
    const newWeekData = latestRegularAttended > (currentWeek || 0);
    if (isPrimaryFire(now) && !newWeekData) {
      console.log('[SyncFromMelee] Try-1 with no new-round data; deferring advance to the retry fire.');
      return { status: 'synced-deferred', action: 'advance', targetWeek: nextWeek };
    }
    await updateSettingsBatch(DB, [[SETTINGS_KEY.CURRENT_WEEK, `${WEEK_PREFIX}${nextWeek}`], [SETTINGS_KEY.LAST_ADVANCED, today]]);
    console.log(`[SyncFromMelee] Advanced to Week ${nextWeek}.`);
    return { status: 'advanced', week: nextWeek };
  }
  console.log('[SyncFromMelee] Gate not met; data synced, no advance.');
  return { status: 'synced-no-advance' };
}
