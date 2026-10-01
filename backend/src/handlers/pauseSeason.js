import { updateSetting } from '../db/queries.js';
import { requireAdmin } from '../lib/auth.js';
import { SETTINGS_KEY, SET_TRUE, SET_FALSE } from '../lib/constants.js';

export async function handlePauseSeason(body, env) {
  const { DB } = env;
  requireAdmin(body, env);

  await updateSetting(DB, SETTINGS_KEY.SEASON_PAUSED, SET_TRUE);
  return { paused: true };
}

export async function handleResumeSeason(body, env) {
  const { DB } = env;
  requireAdmin(body, env);

  await updateSetting(DB, SETTINGS_KEY.SEASON_PAUSED, SET_FALSE);
  return { resumed: true };
}
