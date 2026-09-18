import { getSettings, parseSeasonId, parseWeek } from '../db/queries.js';
import { getWeeklyParticipation as getWeeklyParticipationCount } from '../lib/participation.js';

export async function handleGetWeeklyParticipation(body, env) {
  const { DB } = env;
  const settings = await getSettings(DB);
  const rawSeasonId = settings.ACTIVE_SEASON_ID || '';
  const activeSeasonId = rawSeasonId ? parseSeasonId(rawSeasonId) : null;
  const currentWeek = parseWeek(settings.CURRENT_WEEK);

  if (!activeSeasonId || !currentWeek) {
    return { weeklyParticipation: null };
  }

  const weeklyParticipation = await getWeeklyParticipationCount(DB, activeSeasonId, currentWeek);
  return { weeklyParticipation };
}
