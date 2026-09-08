import { MeleeClient } from '../lib/melee.js';
import { getSettings, updateSetting, parseSeasonId, parseWeek, isSeasonStarted, isVotingOpen, findPlayerByMelee, getAllActivePlayers } from '../db/queries.js';
import { computeSchemer, computeAmbassador, computeChampion, computeBountyHunter, writePodiumBlock } from '../lib/awards.js';
import { fetchLeagueTournaments, buildWeekMap } from '../lib/meleeLeague.js';
import { computeSeasonTable } from '../lib/seasonTable.js';

export function shouldAdvance(isoNow, marker, weekKey) {
  const date = new Date(isoNow);
  const stockholmTime = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Stockholm',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).format(date);
  const [hours, minutes] = stockholmTime.split(':').map(Number);
  const isLateEnough = hours > 22 || (hours === 22 && minutes >= 10);
  const notYetAdvanced = marker !== weekKey;
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
    return;
  }

  const activeSeasonId = parseSeasonId(settings.ACTIVE_SEASON_ID);
  const currentWeek = parseWeek(settings.CURRENT_WEEK);
  const votingOpen = isVotingOpen(settings.VOTING_OPEN);
  const isPaused = settings.SEASON_PAUSED === 'TRUE';
  const lastAdvanced = settings.LAST_ADVANCED || '';

  if (!activeSeasonId) {
    console.log('[SyncFromMelee] No active season; skipping.');
    return;
  }

  const clientId = env.MELEE_CLIENT_ID || '';
  const clientSecret = env.MELEE_CLIENT_SECRET || '';
  const client = new ClientClass(clientId, clientSecret);

  const allPlayersResult = await DB.prepare('SELECT * FROM players').all();
  const allPlayers = allPlayersResult.results || [];

  const storedTournaments = await DB.prepare(
    'SELECT melee_id FROM melee_tournaments WHERE season_id = ?'
  ).bind(activeSeasonId).all();
  const existingIds = new Set((storedTournaments.results || []).map(t => t.melee_id));

  const matchedTournaments = await fetchLeagueTournaments(client, { targetSeason: activeSeasonId });

  const season = await DB.prepare('SELECT length, top_results FROM seasons WHERE id = ?').bind(activeSeasonId).first();
  const seasonLength = season?.length || 11;
  const topResults = season?.top_results || 7;

  const weekMap = buildWeekMap(matchedTournaments);

  for (const [meleeId, info] of weekMap) {
    if (existingIds.has(meleeId)) continue;
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

  const playerMap = new Map(allPlayers.map(p => [p.melee_name?.toLowerCase(), p]));
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
      const username = s.Team?.Players?.[0]?.Username;
      if (!username) continue;
      const player = playerMap.get(username.toLowerCase());
      const playerId = player ? player.id : null;

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

      if (playerId) attendedThisRound.add(playerId);
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

      const p1Username = comps[0].Team?.Players?.[0]?.Username;
      const p2Username = comps[1].Team?.Players?.[0]?.Username;
      if (!p1Username || !p2Username) continue;

      const p1Id = findPlayerIdByMelee(allPlayers, p1Username);
      const p2Id = findPlayerIdByMelee(allPlayers, p2Username);
      if (!p1Id || !p2Id) continue;

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
    return;
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

  const allStandings = await DB.prepare(
    'SELECT round, player_id, wins, losses, draws, match_points, rank FROM season_standings WHERE season_id = ?'
  ).bind(activeSeasonId).all();

  const nights = (allStandings.results || []).map(s => ({
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
  const midTable = computeSeasonTable(
    nights.filter(n => n.round <= midRound),
    topResults
  );
  const midRankMap = new Map(midTable.map(r => [r.playerId, r.rank]));

  const climbers = seasonTable
    .map(r => ({
      playerId: r.playerId,
      climb: (midRankMap.get(r.playerId) || 0) - r.rank,
    }))
    .filter(c => c.climb > 0)
    .sort((a, b) => b.climb - a.climb)
    .slice(0, 3);

  if (climbers.length > 0) {
    await writePodiumBlock(DB, activeSeasonId, 'A New Hope', climbers.map(c => ({
      playerId: c.playerId, score: c.climb, name: '',
    })));
  }

  const weekKey = `S${activeSeasonId}-W${currentWeek}`;
  const canAdvance = shouldAdvance(now, lastAdvanced, weekKey);

  if (!votingOpen && canAdvance) {
    await updateSetting(DB, 'VOTING_OPEN', 'TRUE');
    await updateSetting(DB, 'LAST_ADVANCED', weekKey);
    console.log('[SyncFromMelee] First run — voting opened.');
  } else if (canAdvance) {
    const nextWeek = (currentWeek || 0) + 1;
    if (nextWeek > seasonLength) {
      const champion = await computeChampion(DB, activeSeasonId);
      if (champion.length > 0) {
        await writePodiumBlock(DB, activeSeasonId, 'Galactic Champion', champion);
      }
      await updateSetting(DB, 'CURRENT_WEEK', 'Season Ended');
      await updateSetting(DB, 'VOTING_OPEN', 'FALSE');
      await updateSetting(DB, 'SEASON_STARTED', 'FALSE');
      console.log('[SyncFromMelee] Season ended.');
    } else {
      await updateSetting(DB, 'CURRENT_WEEK', `Week ${nextWeek}`);
      await updateSetting(DB, 'LAST_ADVANCED', weekKey);
      console.log(`[SyncFromMelee] Advanced to Week ${nextWeek}.`);
    }
  } else {
    console.log('[SyncFromMelee] Gate not met; data synced, no advance.');
  }

  console.log('[SyncFromMelee] Sync complete.');
}

function findPlayerIdByMelee(players, meleeUsername) {
  const found = players.find(p => p.melee_name && p.melee_name.toLowerCase() === meleeUsername.toLowerCase());
  return found ? found.id : null;
}
