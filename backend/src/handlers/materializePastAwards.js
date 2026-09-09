import { constantTimeEqual } from '../lib/auth.js';
import { computeChampion, computeBountyHunter, writePodiumBlock } from '../lib/awards.js';
import { computeSeasonTable } from '../lib/seasonTable.js';
import { parseSeasonId } from '../db/queries.js';
import { badRequest } from '../lib/errors.js';

export async function handleMaterializePastAwards(body, env) {
  const { DB, ADMIN_SECRET } = env;
  const { adminToken, seasonId: rawSeasonId, dryRun } = body;

  if (!adminToken || !constantTimeEqual(adminToken, ADMIN_SECRET || '')) {
    const err = new Error('Unauthorized. Invalid admin token.');
    err.status = 403;
    throw err;
  }

  const seasonId = parseSeasonId(rawSeasonId);
  if (seasonId == null) throw badRequest('Invalid or missing seasonId.');

  if (seasonId >= 6) {
    const err = new Error('materializePastAwards is only for seasons S1-S5. Use close sequence for S6+.');
    err.status = 400;
    throw err;
  }

  const podiums = {};

  const regularRounds = await DB.prepare(
    'SELECT DISTINCT round FROM melee_tournaments WHERE season_id = ? AND phase = ?'
  ).bind(seasonId, 'regular').all();
  const regularRoundSet = new Set((regularRounds.results || []).map(r => r.round));

  const allStandings = await DB.prepare(
    'SELECT round, player_id, wins, losses, draws, match_points, rank FROM season_standings WHERE season_id = ?'
  ).bind(seasonId).all();

  const season = await DB.prepare('SELECT length, top_results FROM seasons WHERE id = ?').bind(seasonId).first();
  const topResults = season?.top_results || 7;

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

  podiums['Galactic Ruler'] = seasonTable
    .filter(r => r.rank <= 3)
    .map(r => ({ playerId: r.playerId, score: r.points }));

  const champion = await computeChampion(DB, seasonId);
  podiums['Galactic Champion'] = champion;

  const bountyHunter = await computeBountyHunter(DB, seasonId);
  podiums['Bounty Hunter'] = bountyHunter;

  if (seasonId > 1) {
    const seasonLength = season?.length || 11;
    const midRound = Math.floor(seasonLength / 2);

    // Mid-season: raw accumulated standings
    const regularRoundsForMid = await DB.prepare(
      'SELECT DISTINCT round FROM melee_tournaments WHERE season_id = ? AND phase = ? AND round <= ?'
    ).bind(seasonId, 'regular', midRound).all();
    const regularMidRoundSet = new Set((regularRoundsForMid.results || []).map(r => r.round));

    const midStandings = await DB.prepare(
      'SELECT player_id, round, match_points FROM season_standings WHERE season_id = ? AND round <= ?'
    ).bind(seasonId, midRound).all();

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

    podiums['A New Hope'] = climbers.map(c => ({ playerId: c.playerId, score: c.climb }));
  } else {
    podiums['A New Hope'] = [];
  }

  podiums['Galactic Schemer'] = [];
  podiums['Galactic Ambassador'] = [];

  if (!dryRun) {
    for (const [awardName, entries] of Object.entries(podiums)) {
      if (entries.length > 0) {
        await writePodiumBlock(DB, seasonId, awardName, entries);
      }
    }
  }

  return { podiums, dryRun: !!dryRun };
}
