import { MeleeClient } from '../lib/melee.js';
import { getSettings, updateSetting, parseSeasonId, parseWeek, isSeasonStarted, isVotingOpen, findPlayerByMelee, getAllActivePlayers } from '../db/queries.js';
import { computeSchemer, computeAmbassador, writePodiumBlock } from '../lib/awards.js';

const LEAGUE_REGEX = /^SWU Wednesday league(?: season (\d+))?(?:\s+\d{1,2}\/\d{1,2}|\s+(?:top [48]|best of the rest|playoff|championship|finale))/i;
const EXCLUDED_KEYWORDS = ['prerelease', 'draft', 'clone', 'budget draft'];

function isLeagueTournament(name) {
  if (!LEAGUE_REGEX.test(name)) return false;
  const lower = name.toLowerCase();
  return !EXCLUDED_KEYWORDS.some(kw => lower.includes(kw));
}

function extractSeasonAndRound(name) {
  const match = name.match(LEAGUE_REGEX);
  if (!match) return null;

  const weekMatch = name.match(/\(week (\d+)\)/i);
  const week = weekMatch ? parseInt(weekMatch[1], 10) : null;

  return { seasonNum: match[1] ? parseInt(match[1], 10) : null, week };
}

function findPlayerIdByMelee(players, meleeUsername) {
  const found = players.find(p => p.melee_name && p.melee_name.toLowerCase() === meleeUsername.toLowerCase());
  return found ? found.id : null;
}

export async function syncFromMelee(env, deps = {}) {
  const { DB } = env;
  const ClientClass = deps.MeleeClient || MeleeClient;

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

  let page = 0;
  const pageSize = 50;
  let hasMore = true;
  const matchedTournaments = [];

  while (hasMore) {
    let response;
    try {
      response = await client.listTournaments(null, page, pageSize);
    } catch (err) {
      console.error(`[SyncFromMelee] Failed to list tournaments: ${err.message}`);
      break;
    }

    const content = response.Content || [];
    for (const t of content) {
      if (!isLeagueTournament(t.Name)) continue;
      const info = extractSeasonAndRound(t.Name);
      if (!info) continue;
      if (info.seasonNum !== activeSeasonId) continue;
      matchedTournaments.push({ ...t, extractedWeek: info.week });
    }

    const total = response.RecordsTotal || response.TotalCount || 0;
    page++;
    hasMore = page * pageSize < total && content.length > 0;
  }

  matchedTournaments.sort((a, b) => new Date(a.StartDate || a.LastPairDateTime) - new Date(b.StartDate || b.LastPairDateTime));

  const weekMap = new Map();
  let seq = 1;
  for (const t of matchedTournaments) {
    const round = t.extractedWeek || seq++;
    weekMap.set(t.ID, { meleeId: t.ID, round, name: t.Name, date: t.StartDate || t.LastPairDateTime || null });
  }

  const seasonLength = weekMap.size || 11;

  for (const [, info] of weekMap) {
    if (existingIds.has(info.meleeId)) continue;
    try {
      await DB.prepare(
        'INSERT OR IGNORE INTO melee_tournaments (melee_id, season_id, round, name, date) VALUES (?, ?, ?, ?, ?)'
      ).bind(info.meleeId, activeSeasonId, info.round, info.name, info.date).run();
    } catch (err) {
      console.error(`[SyncFromMelee] Failed to insert tournament ${info.meleeId}: ${err.message}`);
    }
  }

  const standingsInSeason = await DB.prepare(
    'SELECT DISTINCT round FROM season_standings WHERE season_id = ?'
  ).bind(activeSeasonId).all();
  const alreadySyncedRounds = new Set((standingsInSeason.results || []).map(r => r.round));

  const playerMap = new Map(allPlayers.map(p => [p.melee_name?.toLowerCase(), p]));
  const roundAttendance = new Map();

  for (const [, info] of weekMap) {
    if (alreadySyncedRounds.has(info.round)) continue;

    let standingsResp;
    try {
      standingsResp = await client.getStandings(info.meleeId);
    } catch (err) {
      console.error(`[SyncFromMelee] Failed to get standings for tournament ${info.meleeId}: ${err.message}`);
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
      matchesResp = await client.getMatches(info.meleeId);
    } catch (err) {
      console.error(`[SyncFromMelee] Failed to get matches for tournament ${info.meleeId}: ${err.message}`);
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

  const schemer = await computeSchemer(DB, activeSeasonId);
  if (schemer.length > 0) {
    await writePodiumBlock(DB, activeSeasonId, 'Galactic Schemer', schemer);
  }

  const ambassador = await computeAmbassador(DB, activeSeasonId);
  if (ambassador.length > 0) {
    await writePodiumBlock(DB, activeSeasonId, 'Galactic Ambassador', ambassador);
  }

  const finalStandings = await DB.prepare(
    'SELECT player_id, rank, match_points FROM season_standings WHERE season_id = ? AND round = (SELECT MAX(round) FROM season_standings WHERE season_id = ?)'
  ).bind(activeSeasonId, activeSeasonId).all();

  const top3 = (finalStandings.results || []).filter(s => s.rank <= 3).slice(0, 3);
  const rulerEntries = [];
  for (const s of top3) {
    if (s.player_id) rulerEntries.push({ playerId: s.player_id, score: s.match_points, name: '' });
  }
  if (rulerEntries.length > 0) {
    await writePodiumBlock(DB, activeSeasonId, 'Galactic Ruler', rulerEntries);
  }

  const midRound = Math.floor(seasonLength / 2);
  const midStandings = await DB.prepare(
    'SELECT player_id, rank FROM season_standings WHERE season_id = ? AND round = ?'
  ).bind(activeSeasonId, midRound).all();
  const midMap = new Map((midStandings.results || []).map(s => [s.player_id, s.rank]));

  const finalAll = finalStandings.results || [];
  const climbers = finalAll
    .map(s => ({
      playerId: s.player_id,
      climb: (midMap.get(s.player_id) || 0) - s.rank,
    }))
    .filter(c => c.climb > 0)
    .sort((a, b) => b.climb - a.climb)
    .slice(0, 3);

  if (climbers.length > 0) {
    await writePodiumBlock(DB, activeSeasonId, 'A New Hope', climbers.map(c => ({
      playerId: c.playerId, score: c.climb, name: '',
    })));
  }

  if (!votingOpen) {
    await updateSetting(DB, 'VOTING_OPEN', 'TRUE');
    console.log('[SyncFromMelee] First run — voting opened.');
  } else {
    const nextWeek = (currentWeek || 0) + 1;
    if (nextWeek > seasonLength) {
      for (const player of allPlayers) {
        if (!allAttended.has(player.id)) {
          try {
            await DB.prepare('UPDATE players SET active = ? WHERE id = ?').bind(0, player.id).run();
          } catch (err) {
            console.error(`[SyncFromMelee] Failed to deactivate player ${player.id}: ${err.message}`);
          }
        }
      }
      await updateSetting(DB, 'CURRENT_WEEK', 'Season Ended');
      await updateSetting(DB, 'VOTING_OPEN', 'FALSE');
      await updateSetting(DB, 'SEASON_STARTED', 'FALSE');
      console.log('[SyncFromMelee] Season ended.');
    } else {
      await updateSetting(DB, 'CURRENT_WEEK', `Week ${nextWeek}`);
      console.log(`[SyncFromMelee] Advanced to Week ${nextWeek}.`);
    }
  }

  console.log('[SyncFromMelee] Sync complete.');
}
