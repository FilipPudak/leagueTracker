import { getMaxSeasonId, updateSettingsBatch, parseSeasonId } from '../db/queries.js';
import { requireAdmin } from '../lib/auth.js';
import { badRequest } from '../lib/errors.js';
import { SETTINGS_KEY, WEEK_PREFIX, SET_TRUE, SET_FALSE } from '../lib/constants.js';

export async function handleStartNewSeason(body, env) {
  const { DB } = env;
  requireAdmin(body, env);

  const { seasonId: requestedId } = body;
  const maxId = await getMaxSeasonId(DB);
  let nextSeasonId;
  if (requestedId != null && requestedId !== '') {
    nextSeasonId = parseSeasonId(requestedId);
    if (nextSeasonId == null) throw badRequest('Invalid seasonId. Use a number or prefix like "S7".');
  } else {
    nextSeasonId = maxId + 1;
  }
  const nextSeasonName = `Season ${nextSeasonId}`;
  const today = new Date().toISOString().split('T')[0];

  const existing = await DB.prepare('SELECT id FROM seasons WHERE id = ?')
    .bind(nextSeasonId).first();

  if (!existing) {
    await DB.prepare(
      'INSERT INTO seasons (id, name, created_date) VALUES (?, ?, ?)'
    ).bind(nextSeasonId, nextSeasonName, today).run();
  }

  await updateSettingsBatch(DB, [
    [SETTINGS_KEY.ACTIVE_SEASON_ID, String(nextSeasonId)],
    [SETTINGS_KEY.CURRENT_WEEK, `${WEEK_PREFIX}1`],
    [SETTINGS_KEY.VOTING_OPEN, SET_FALSE],
    [SETTINGS_KEY.SEASON_STARTED, SET_TRUE],
  ]);

  return { seasonId: nextSeasonId, seasonName: nextSeasonName };
}
