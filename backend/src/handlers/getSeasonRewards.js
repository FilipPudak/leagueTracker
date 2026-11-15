import { getSettings, getSeasonById, parseSeasonId, parseWeek } from '../db/queries.js';
import { requireAdmin } from '../lib/auth.js';
import { badRequest } from '../lib/errors.js';
import { computeSeasonRewards } from '../lib/seasonRewards.js';
import { PHASE, SEASON_ENDED_WEEK } from '../lib/constants.js';

export async function handleGetSeasonRewards(body, env) {
  const { DB } = env;
  requireAdmin(body, env);

  const seasonId = parseSeasonId(body?.seasonId);
  if (seasonId == null) throw badRequest('Invalid or missing seasonId.');

  const season = await getSeasonById(DB, seasonId);
  if (!season) throw badRequest(`Unknown season: ${seasonId}.`);

  const [settings, votes, attendance, players] = await Promise.all([
    getSettings(DB),
    DB.prepare('SELECT player_id, week FROM votes WHERE season_id = ?').bind(seasonId).all(),
    DB.prepare(`
      SELECT a.player_id, a.week FROM attendance a
      JOIN melee_tournaments t ON t.season_id = a.season_id AND t.round = a.week
      WHERE a.season_id = ? AND t.phase = ?
    `).bind(seasonId, PHASE.REGULAR).all(),
    DB.prepare('SELECT id, name, active FROM players').all(),
  ]);

  const activeSeasonId = parseSeasonId(settings.ACTIVE_SEASON_ID);
  const isActiveSeason = activeSeasonId != null && seasonId === activeSeasonId;
  const seasonEnded = settings.CURRENT_WEEK === SEASON_ENDED_WEEK
    || (activeSeasonId != null && !isActiveSeason);
  const cutoffWeek = isActiveSeason && !seasonEnded ? parseWeek(settings.CURRENT_WEEK) : null;

  const rewards = computeSeasonRewards({
    players: players.results || [],
    votes: votes.results || [],
    attendance: attendance.results || [],
    cutoffWeek,
  });

  return {
    seasonId,
    seasonName: season.name,
    isActiveSeason,
    seasonEnded,
    ...rewards,
  };
}
