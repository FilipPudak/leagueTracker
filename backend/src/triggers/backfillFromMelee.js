import { MeleeClient } from '../lib/melee.js';
import { getAllActivePlayers, findPlayerByMelee } from '../db/queries.js';

const LEAGUE_REGEX = /^SWU Wednesday league(?: season (\d+))?\s+\d{1,2}\/\d{1,2}/i;
const EXCLUDED_KEYWORDS = ['top 8', 'top 4', 'best of the rest', 'playoff', 'championship', 'prerelease', 'draft', 'clone', 'budget draft'];

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

export async function backfillFromMelee(env, deps = {}) {
  const { DB } = env;
  const ClientClass = deps.MeleeClient || MeleeClient;
  const targetSeasonId = deps.seasonId || null;

  console.log('[Backfill] Starting backfill...');

  const clientId = env.MELEE_CLIENT_ID || '';
  const clientSecret = env.MELEE_CLIENT_SECRET || '';
  const client = new ClientClass(clientId, clientSecret);

  const allPlayersResult = await DB.prepare('SELECT * FROM players').all();
  const allPlayers = allPlayersResult.results || [];
  const playerMap = new Map(allPlayers.map(p => [p.melee_name?.toLowerCase(), p]));

  let page = 0;
  const pageSize = 50;
  let hasMore = true;
  const allTournaments = [];

  while (hasMore) {
    let response;
    try {
      response = await client.listTournaments(null, page, pageSize);
    } catch (err) {
      console.error(`[Backfill] Failed to list tournaments: ${err.message}`);
      break;
    }

    const content = response.Content || [];
    for (const t of content) {
      if (!isLeagueTournament(t.Name)) continue;
      const info = extractSeasonAndRound(t.Name);
      if (!info) continue;
      if (targetSeasonId && info.seasonNum && info.seasonNum !== targetSeasonId) continue;
      if (info.seasonNum === null) continue;
      allTournaments.push({ ...t, extractedWeek: info.week, seasonNum: info.seasonNum });
    }

    const total = response.TotalCount || 0;
    page++;
    hasMore = page * pageSize < total && content.length > 0;
  }

  allTournaments.sort((a, b) => a.seasonNum - b.seasonNum || new Date(a.StartDate) - new Date(b.StartDate));

  const seasonGroups = new Map();
  for (const t of allTournaments) {
    if (!seasonGroups.has(t.seasonNum)) seasonGroups.set(t.seasonNum, []);
    seasonGroups.get(t.seasonNum).push(t);
  }

  let totalTournaments = 0;
  let totalStandings = 0;
  let totalMatches = 0;

  for (const [seasonNum, tournaments] of seasonGroups) {
    const existingTournaments = await DB.prepare(
      'SELECT melee_id FROM melee_tournaments WHERE season_id = ?'
    ).bind(seasonNum).all();
    const existingIds = new Set((existingTournaments.results || []).map(t => t.melee_id));

    const weekMap = new Map();
    let seq = 1;
    for (const t of tournaments) {
      const round = t.extractedWeek || seq++;
      weekMap.set(t.ID, { meleeId: t.ID, round, name: t.Name, date: t.StartDate });
    }

    for (const [, info] of weekMap) {
      if (existingIds.has(info.meleeId)) continue;

      try {
        await DB.prepare(
          'INSERT OR IGNORE INTO melee_tournaments (melee_id, season_id, round, name, date) VALUES (?, ?, ?, ?, ?)'
        ).bind(info.meleeId, seasonNum, info.round, info.name, info.date).run();
        totalTournaments++;
      } catch (err) {
        console.error(`[Backfill] Failed to insert tournament ${info.meleeId}: ${err.message}`);
        continue;
      }

      let standingsResp;
      try {
        standingsResp = await client.getStandings(info.meleeId);
      } catch (err) {
        console.error(`[Backfill] Failed to get standings for ${info.meleeId}: ${err.message}`);
        continue;
      }

      for (const s of (standingsResp.Content || [])) {
        const username = s.Team?.Players?.[0]?.Username;
        if (!username) continue;
        const player = playerMap.get(username.toLowerCase());
        const playerId = player ? player.id : null;

        try {
          await DB.prepare(
            'DELETE FROM season_standings WHERE season_id = ? AND round = ? AND player_id = ?'
          ).bind(seasonNum, info.round, playerId).run();
          await DB.prepare(
            'INSERT INTO season_standings (season_id, round, player_id, wins, losses, draws, match_points, rank) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
          ).bind(seasonNum, info.round, playerId, s.MatchWins || 0, s.MatchLosses || 0, s.MatchDraws || 0, s.Points || 0, s.Rank || null).run();
          totalStandings++;
        } catch (err) {
          console.error(`[Backfill] Failed to insert standing: ${err.message}`);
        }
      }

      let matchesResp;
      try {
        matchesResp = await client.getMatches(info.meleeId);
      } catch (err) {
        console.error(`[Backfill] Failed to get matches for ${info.meleeId}: ${err.message}`);
        continue;
      }

      for (const m of (matchesResp.Content || [])) {
        const comps = m.Competitors || [];
        if (comps.length < 2) continue;

        const p1Username = comps[0].Team?.Players?.[0]?.Username;
        const p2Username = comps[1].Team?.Players?.[0]?.Username;
        if (!p1Username || !p2Username) continue;

        const p1Id = findPlayerIdByMelee(allPlayers, p1Username);
        const p2Id = findPlayerIdByMelee(allPlayers, p2Username);
        if (!p1Id || !p2Id) continue;

        const winnerGuid = m.WinnerId;
        let winnerId = null;
        if (winnerGuid) {
          if (comps[0].Team?.ID === winnerGuid || comps[0].Team?.Players?.[0]?.ID === winnerGuid) {
            winnerId = p1Id;
          } else if (comps[1].Team?.ID === winnerGuid || comps[1].Team?.Players?.[0]?.ID === winnerGuid) {
            winnerId = p2Id;
          }
        }

        try {
          await DB.prepare(
            'DELETE FROM match_results WHERE season_id = ? AND round = ? AND melee_match_id = ?'
          ).bind(seasonNum, info.round, m.ID).run();
          await DB.prepare(
            'INSERT INTO match_results (season_id, round, melee_match_id, player1_id, player2_id, winner_id, result, is_bye) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
          ).bind(seasonNum, info.round, m.ID, p1Id, p2Id, winnerId, m.ResultString || null, m.ByeReason ? 1 : 0).run();
          totalMatches++;
        } catch (err) {
          console.error(`[Backfill] Failed to insert match: ${err.message}`);
        }
      }
    }
  }

  console.log(`[Backfill] Complete: ${totalTournaments} tournaments, ${totalStandings} standings, ${totalMatches} matches`);
  return { seasonId: targetSeasonId, tournaments: totalTournaments, standings: totalStandings, matches: totalMatches };
}

function findPlayerIdByMelee(players, meleeUsername) {
  const found = players.find(p => p.melee_name && p.melee_name.toLowerCase() === meleeUsername.toLowerCase());
  return found ? found.id : null;
}
