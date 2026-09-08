import { getMaxSeasonId, updateSetting } from '../db/queries.js';
import { constantTimeEqual } from '../lib/auth.js';

export async function handleStartNewSeason(body, env) {
  const { DB } = env;
  const { adminToken } = body;

  if (!adminToken || !constantTimeEqual(adminToken, env.ADMIN_SECRET || '')) {
    const err = new Error('Unauthorized. Invalid admin token.');
    err.status = 403;
    throw err;
  }

  const { seasonId: requestedId } = body;
  const maxId = await getMaxSeasonId(DB);
  const nextSeasonId = requestedId || maxId + 1;
  const nextSeasonName = `Season ${nextSeasonId}`;
  const today = new Date().toISOString().split('T')[0];

  const existing = await DB.prepare('SELECT id FROM seasons WHERE id = ?')
    .bind(nextSeasonId).first();

  if (!existing) {
    await DB.prepare(
      'INSERT INTO seasons (id, name, created_date) VALUES (?, ?, ?)'
    ).bind(nextSeasonId, nextSeasonName, today).run();
  }

  await updateSetting(DB, 'ACTIVE_SEASON_ID', String(nextSeasonId));
  await updateSetting(DB, 'CURRENT_WEEK', 'Week 1');
  await updateSetting(DB, 'VOTING_OPEN', 'FALSE');
  await updateSetting(DB, 'SEASON_STARTED', 'TRUE');

  return { seasonId: nextSeasonId, seasonName: nextSeasonName };
}
