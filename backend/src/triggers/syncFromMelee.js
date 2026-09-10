import { MeleeClient } from '../lib/melee.js';
import { getSettings, updateSetting, parseSeasonId, parseWeek, isSeasonStarted, isSeasonPaused, isVotingOpen } from '../db/queries.js';
import { computeSchemer, computeAmbassador, computeChampion, computeBountyHunter, writePodiumBlock } from '../lib/awards.js';
import { fetchLeagueTournaments, buildWeekMap, createPlayerFinder } from '../lib/meleeLeague.js';
import { computeSeasonTable } from '../lib/seasonTable.js';

export function shouldAdvance(isoNow, marker) {
  const date = new Date(isoNow);
  const stockholmTime = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Stockholm',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).format(date);
  const [hours, minutes] = stockholmTime.split(':').map(Number);
  const isLateEnough = hours > 22 || (hours === 22 && minutes >= 10);
  const today = isoNow.split('T')[0];
  const notYetAdvanced = marker !== today;
  return isLateEnough && notYetAdvanced;
}

export async function syncFromMelee(env, deps = {}) {
  const { DB } = env;
  const ClientClass = deps.MeleeClient || MeleeClient;
  const now = deps.now || new Date().toISOString();

  console.log('[SyncFromMelee] Starting weekly sync...');

  const settings = await getSettings(DB);
  const seasonStarted = isSeasonStarted(settings.SEASON_STARTED);

  if (!seasonStarted) {
    console.log('[SyncFromMelee] Season not started; skipping.');
    return { status: 'skipped', reason: 'season-not-started' };
  }

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

  const allPlayersResult = await DB.prepare('SELECT * FROM players').all();
  const allPlayers = allPlayersResult.results || [];

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
  const seasonLength = season?.length || 11;
  const topResults = season?.top_results || 7;

  const weekMap = buildWeekMap(matchedTournaments, existingRoundMap);

  for (const [meleeId, info] of weekMap) {
    if (existingRoundMap.has(meleeId)) continue;
    try {
      await DB.prepare(
        'INSERT OR IGNORE INTO melee_tournaments (melee_id, season_id, round, name, date, phase) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(meleeId, activeSeasonId, info.round, info.name, info.date, info.phase || 'regular').run();
    } catch (err) {
      console.error(`[SyncFromMelee] Failed to insert tournament ${meleeId}: ${err.message}`);
    }
  }

  const standingsInSeason = await DB.prepare(
    'SELECT DISTINCT round FROM season_standings WHERE season_id = ?'
  ).bind(activeSeasonId).all();
  const syncedStandingsRounds = new Set((standingsInSeason.results || []).map(r => r.round));

  const matchesInSeason = await DB.prepare(
    'SELECT DISTINCT round FROM match_results WHERE season_id = ?'
  ).bind(activeSeasonId).all();
  const syncedMatchesRounds = new Set((matchesInSeason.results || []).map(r => r.round));

  const createdPlayers = new Map();
  const finder = createPlayerFinder(DB, { onCreated: p => createdPlayers.set(p.id, p) });
  const roundAttendance = new Map();

  for (const [meleeId, info] of weekMap) {
    if (syncedStandingsRounds.has(info.round) && syncedMatchesRounds.has(info.round)) continue;

    let standingsResp;
    try {
      standingsResp = await client.getStandings(meleeId);
    } catch (err) {
      console.error(`[SyncFromMelee] Failed to get standings for tournament ${meleeId}: ${err.message}`);
      continue;
    }

    const attendedThisRound = new Set();
    const standings = standingsResp.Content || [];
    for (const s of standings) {
      const meleePlayer = s.Team?.Players?.[0];
      const username = meleePlayer?.Username;
      if (!username) continue;
      const displayName = meleePlayer.DisplayName || meleePlayer.Name || username;
      const playerId = await finder.find(username, displayName);

      try {
        await DB.prepare(
          'DELETE FROM season_standings WHERE season_id = ? AND round = ? AND player_id = ?'
        ).bind(activeSeasonId, info.round, playerId).run();
        await DB.prepare(
          'INSERT INTO season_standings (season_id, round, player_id, wins, losses, draws, match_points, rank) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(
          activeSeasonId,
          info.round,
          playerId,
          s.MatchWins || 0,
          s.MatchLosses || 0,
          s.MatchDraws || 0,
          s.Points || 0,
          s.Rank || null
        ).run();
      } catch (err) {
        console.error(`[SyncFromMelee] Failed to insert standing: ${err.message}`);
      }

      attendedThisRound.add(playerId);
    }

    roundAttendance.set(info.round, attendedThisRound);

    let matchesResp;
    try {
      matchesResp = await client.getMatches(meleeId);
    } catch (err) {
      console.error(`[SyncFromMelee] Failed to get matches for tournament ${meleeId}: ${err.message}`);
      continue;
    }

    const matches = matchesResp.Content || [];
    for (const m of matches) {
      const comps = m.Competitors || [];
      if (comps.length < 2) continue;

      const p1Player = comps[0].Team?.Players?.[0];
      const p2Player = comps[1].Team?.Players?.[0];
      const p1Username = p1Player?.Username;
      const p2Username = p2Player?.Username;
      if (!p1Username || !p2Username) continue;

      const p1Id = await finder.find(p1Username, p1Player.DisplayName || p1Player.Name || p1Username);
      const p2Id = await finder.find(p2Username, p2Player.DisplayName || p2Player.Name || p2Username);

      const p1Wins = comps[0].GameWins || 0;
      const p2Wins = comps[1].GameWins || 0;
      let winnerId = null;
      if (p1Wins > p2Wins) winnerId = p1Id;
      else if (p2Wins > p1Wins) winnerId = p2Id;

      const isBye = !!m.ByeReason;

      const matchGuid = m.Guid || m.ID;
      try {
        await DB.prepare(
          'DELETE FROM match_results WHERE season_id = ? AND round = ? AND melee_match_id = ?'
        ).bind(activeSeasonId, info.round, matchGuid).run();
        await DB.prepare(
          'INSERT INTO match_results (season_id, round, melee_match_id, player1_id, player2_id, winner_id, result, is_bye) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(
          activeSeasonId,
          info.round,
          matchGuid,
          p1Id,
          p2Id,
          winnerId,
          m.ResultString || null,
          isBye ? 1 : 0
        ).run();
      } catch (err) {
        console.error(`[SyncFromMelee] Failed to insert match: ${err.message}`);
      }
    }
  }

  if (createdPlayers.size > 0) {
    console.log(`[SyncFromMelee] Auto-created ${createdPlayers.size} player(s) from Melee data: ${[...createdPlayers.values()].map(p => `${p.id} (${p.melee_name})`).join(', ')}`);
  }

  for (const [round, players] of roundAttendance) {
    for (const playerId of players) {
      try {
        await DB.prepare(
          'INSERT OR IGNORE INTO attendance (season_id, week, player_id) VALUES (?, ?, ?)'
        ).bind(activeSeasonId, round, playerId).run();
      } catch (err) {
        console.error(`[SyncFromMelee] Failed to record attendance: ${err.message}`);
      }
    }
  }

  const allAttended = new Set([...roundAttendance.values()].flatMap(s => [...s]));

  for (const player of allPlayers) {
    if (allAttended.has(player.id) && player.active !== 1) {
      try {
        await DB.prepare('UPDATE players SET active = ? WHERE id = ?').bind(1, player.id).run();
      } catch (err) {
        console.error(`[SyncFromMelee] Failed to activate player ${player.id}: ${err.message}`);
      }
    }
  }

  if (isPaused) {
    console.log('[SyncFromMelee] Season paused; data synced, skipping advance/open/close.');
    console.log('[SyncFromMelee] Sync complete.');
    return { status: 'paused', syncedTournaments: weekMap.size };
  }

  const schemer = await computeSchemer(DB, activeSeasonId);
  if (schemer.length > 0) {
    await writePodiumBlock(DB, activeSeasonId, 'Galactic Schemer', schemer);
  }

  const ambassador = await computeAmbassador(DB, activeSeasonId);
  if (ambassador.length > 0) {
    await writePodiumBlock(DB, activeSeasonId, 'Galactic Ambassador', ambassador);
  }

  const bountyHunter = await computeBountyHunter(DB, activeSeasonId);
  if (bountyHunter.length > 0) {
    await writePodiumBlock(DB, activeSeasonId, 'Bounty Hunter', bountyHunter);
  }

  const regularRounds = await DB.prepare(`
    SELECT DISTINCT round FROM melee_tournaments WHERE season_id = ? AND phase = 'regular'
  `).bind(activeSeasonId).all();
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
    .map(r => ({ playerId: r.playerId, score: r.points, name: '' }));

  if (rulerEntries.length > 0) {
    await writePodiumBlock(DB, activeSeasonId, 'Galactic Ruler', rulerEntries);
  }

  const midRound = Math.floor(seasonLength / 2);

  const regularRoundsForMid = await DB.prepare(
    'SELECT DISTINCT round FROM melee_tournaments WHERE season_id = ? AND phase = ? AND round <= ?'
  ).bind(activeSeasonId, 'regular', midRound).all();
  const regularMidRoundSet = new Set((regularRoundsForMid.results || []).map(r => r.round));

  const midStandings = await DB.prepare(
    'SELECT player_id, round, match_points FROM season_standings WHERE season_id = ? AND round <= ?'
  ).bind(activeSeasonId, midRound).all();

  const midPointsMap = new Map();
  for (const row of (midStandings.results || [])) {
    if (!regularMidRoundSet.has(row.round)) continue;
    midPointsMap.set(row.player_id, (midPointsMap.get(row.player_id) || 0) + (row.match_points || 0));
  }

  const midEntries = [...midPointsMap.entries()].sort((a, b) => b[1] - a[1]);
  const midRankMap = new Map();
  let midRank = 1;
  for (const [pid] of midEntries) {
    midRankMap.set(pid, midRank++);
  }

  const finalRankMap = new Map(seasonTable.map(r => [r.playerId, r.rank]));

  const climbers = [...midRankMap.keys()]
    .filter(pid => finalRankMap.has(pid))
    .map(pid => ({
      playerId: pid,
      climb: (midRankMap.get(pid) || 0) - (finalRankMap.get(pid) || 0),
    }))
    .filter(c => c.climb > 0)
    .sort((a, b) => b.climb - a.climb)
    .slice(0, 3);

  if (climbers.length > 0) {
    await writePodiumBlock(DB, activeSeasonId, 'A New Hope', climbers.map(c => ({
      playerId: c.playerId, score: c.climb, name: '',
    })));
  }

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

  if (!votingOpen && (canAdvance || weekDataPresent)) {
    await updateSetting(DB, 'VOTING_OPEN', 'TRUE');
    await updateSetting(DB, 'LAST_ADVANCED', today);
    console.log(canAdvance
      ? '[SyncFromMelee] First run — voting opened.'
      : '[SyncFromMelee] Week data present — voting opened by retry fire.');
    return { status: 'voting-opened' };
  } else if (canAdvance) {
    const nextWeek = Math.max((currentWeek || 0) + 1, latestRegularAttended);
    if (nextWeek > seasonLength) {
      const champion = await computeChampion(DB, activeSeasonId);
      if (champion.length > 0) {
        await writePodiumBlock(DB, activeSeasonId, 'Galactic Champion', champion);
      }
      await updateSetting(DB, 'CURRENT_WEEK', 'Season Ended');
      await updateSetting(DB, 'VOTING_OPEN', 'FALSE');
      await updateSetting(DB, 'SEASON_STARTED', 'FALSE');
      console.log('[SyncFromMelee] Season ended.');
      return { status: 'season-ended' };
    } else {
      await updateSetting(DB, 'CURRENT_WEEK', `Week ${nextWeek}`);
      await updateSetting(DB, 'LAST_ADVANCED', today);
      console.log(`[SyncFromMelee] Advanced to Week ${nextWeek}.`);
      return { status: 'advanced', week: nextWeek };
    }
  } else {
    console.log('[SyncFromMelee] Gate not met; data synced, no advance.');
    return { status: 'synced-no-advance' };
  }
}
