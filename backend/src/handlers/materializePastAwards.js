import { requireAdmin } from '../lib/auth.js';
import { computeChampion, computeBountyHunter, computeNewHopeClimbers, writePodiumBlock } from '../lib/awards.js';
import { computeSeasonTable } from '../lib/seasonTable.js';
import { parseSeasonId } from '../db/queries.js';
import { badRequest } from '../lib/errors.js';
import { AWARD, PHASE, DEFAULT_TOP_RESULTS, DEFAULT_SEASON_LENGTH } from '../lib/constants.js';

export async function handleMaterializePastAwards(body, env) {
  const { DB } = env;
  requireAdmin(body, env);

  const { seasonId: rawSeasonId, dryRun } = body;
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
  ).bind(seasonId, PHASE.REGULAR).all();
  const regularRoundSet = new Set((regularRounds.results || []).map(r => r.round));

  const allStandings = await DB.prepare(
    'SELECT round, player_id, wins, losses, draws, match_points, rank FROM season_standings WHERE season_id = ?'
  ).bind(seasonId).all();

  const season = await DB.prepare('SELECT length, top_results FROM seasons WHERE id = ?').bind(seasonId).first();
  const topResults = season?.top_results || DEFAULT_TOP_RESULTS;

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

  podiums[AWARD.RULER] = seasonTable
    .filter(r => r.rank <= 3)
    .map(r => ({ playerId: r.playerId, score: r.points }));

  const champion = await computeChampion(DB, seasonId);
  podiums[AWARD.CHAMPION] = champion;

  const bountyHunter = await computeBountyHunter(DB, seasonId);
  podiums[AWARD.BOUNTY_HUNTER] = bountyHunter;

  if (seasonId > 1) {
    const seasonLength = season?.length || DEFAULT_SEASON_LENGTH;
    const finalRankMap = new Map(seasonTable.map(r => [r.playerId, r.rank]));
    const climbers = await computeNewHopeClimbers(DB, seasonId, finalRankMap, seasonLength);
    podiums[AWARD.NEW_HOPE] = climbers.map(c => ({ playerId: c.playerId, score: c.climb }));
  } else {
    podiums[AWARD.NEW_HOPE] = [];
  }

  podiums[AWARD.SCHEMER] = [];
  podiums[AWARD.AMBASSADOR] = [];

  if (!dryRun) {
    for (const [awardName, entries] of Object.entries(podiums)) {
      if (entries.length > 0) {
        await writePodiumBlock(DB, seasonId, awardName, entries);
      }
    }
  }

  return { podiums, dryRun: !!dryRun };
}
