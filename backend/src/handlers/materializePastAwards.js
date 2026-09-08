import { constantTimeEqual } from '../lib/auth.js';
import { computeChampion, computeBountyHunter, writePodiumBlock } from '../lib/awards.js';
import { computeSeasonTable } from '../lib/seasonTable.js';

export async function handleMaterializePastAwards(body, env) {
  const { DB, ADMIN_SECRET } = env;
  const { adminToken, seasonId, dryRun } = body;

  if (!adminToken || !constantTimeEqual(adminToken, ADMIN_SECRET || '')) {
    const err = new Error('Unauthorized. Invalid admin token.');
    err.status = 403;
    throw err;
  }

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
