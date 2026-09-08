import { MeleeClient } from '../lib/melee.js';
import { fetchLeagueTournaments, buildWeekMap, createPlayerFinder } from '../lib/meleeLeague.js';

export async function backfillFromMelee(env, deps = {}) {
  const { DB } = env;
  const ClientClass = deps.MeleeClient || MeleeClient;
  const targetSeasonId = deps.seasonId || null;
  const maxTournaments = deps.maxTournaments || 15;

  console.log('[Backfill] Starting backfill...');

  const clientId = env.MELEE_CLIENT_ID || '';
  const clientSecret = env.MELEE_CLIENT_SECRET || '';
  const client = new ClientClass(clientId, clientSecret);

  const finder = createPlayerFinder(DB);

  const allTournaments = await fetchLeagueTournaments(client, { targetSeason: targetSeasonId });

  const seasonGroups = new Map();
  for (const t of allTournaments) {
    if (!seasonGroups.has(t.seasonNum)) seasonGroups.set(t.seasonNum, []);
    seasonGroups.get(t.seasonNum).push(t);
  }

  let totalTournaments = 0;
  let totalStandings = 0;
  let totalMatches = 0;
  let tournamentsProcessed = 0;

  for (const [seasonNum, tournaments] of seasonGroups) {
    await DB.prepare('INSERT OR IGNORE INTO seasons (id, name, created_date) VALUES (?, ?, ?)')
      .bind(seasonNum, `Season ${seasonNum}`, null).run();

    const existingTournaments = await DB.prepare(
      'SELECT melee_id FROM melee_tournaments WHERE season_id = ?'
    ).bind(seasonNum).all();
    const existingIds = new Set((existingTournaments.results || []).map(t => t.melee_id));

    const syncedStandings = await DB.prepare(
      'SELECT DISTINCT round FROM season_standings WHERE season_id = ?'
    ).bind(seasonNum).all();
    const syncedRounds = new Set((syncedStandings.results || []).map(r => r.round));

    const weekMap = buildWeekMap(tournaments);

    for (const [, info] of weekMap) {
      if (!existingIds.has(info.meleeId)) {
        try {
          await DB.prepare(
            'INSERT OR IGNORE INTO melee_tournaments (melee_id, season_id, round, name, date) VALUES (?, ?, ?, ?, ?)'
          ).bind(info.meleeId, seasonNum, info.round, info.name, info.date).run();
          totalTournaments++;
        } catch (err) {
          console.error(`[Backfill] Failed to insert tournament ${info.meleeId}: ${err.message}`);
          continue;
        }
      }

      if (syncedRounds.has(info.round)) continue;
      if (tournamentsProcessed >= maxTournaments) continue;
      tournamentsProcessed++;

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
        const displayName = s.Team?.Players?.[0]?.DisplayName || s.Team?.Players?.[0]?.Name || username;
        const playerId = await finder.find(username, displayName);

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

        const p1Name = comps[0].Team?.Players?.[0]?.DisplayName || comps[0].Team?.Players?.[0]?.Name || p1Username;
        const p2Name = comps[1].Team?.Players?.[0]?.DisplayName || comps[1].Team?.Players?.[0]?.Name || p2Username;
        const p1Id = await finder.find(p1Username, p1Name);
        const p2Id = await finder.find(p2Username, p2Name);
        if (!p1Id || !p2Id) continue;

        const p1Wins = comps[0].GameWins || 0;
        const p2Wins = comps[1].GameWins || 0;
        let winnerId = null;
        if (p1Wins > p2Wins) winnerId = p1Id;
        else if (p2Wins > p1Wins) winnerId = p2Id;

        const matchGuid = m.Guid || m.ID;
        try {
          await DB.prepare(
            'DELETE FROM match_results WHERE season_id = ? AND round = ? AND melee_match_id = ?'
          ).bind(seasonNum, info.round, matchGuid).run();
          await DB.prepare(
            'INSERT INTO match_results (season_id, round, melee_match_id, player1_id, player2_id, winner_id, result, is_bye) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
          ).bind(seasonNum, info.round, matchGuid, p1Id, p2Id, winnerId, m.ResultString || null, m.ByeReason ? 1 : 0).run();
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
