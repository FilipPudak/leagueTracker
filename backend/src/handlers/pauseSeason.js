import { updateSetting } from '../db/queries.js';
import { constantTimeEqual } from '../lib/auth.js';

export async function handlePauseSeason(body, env) {
  const { DB, ADMIN_SECRET } = env;
  const { adminToken } = body;

  if (!adminToken || !constantTimeEqual(adminToken, ADMIN_SECRET || '')) {
    const err = new Error('Unauthorized. Invalid admin token.');
    err.status = 403;
    throw err;
  }

  await updateSetting(DB, 'SEASON_PAUSED', 'TRUE');
  return { paused: true };
}

export async function handleResumeSeason(body, env) {
  const { DB, ADMIN_SECRET } = env;
  const { adminToken } = body;

  if (!adminToken || !constantTimeEqual(adminToken, ADMIN_SECRET || '')) {
    const err = new Error('Unauthorized. Invalid admin token.');
    err.status = 403;
    throw err;
  }

  await updateSetting(DB, 'SEASON_PAUSED', 'FALSE');
  return { resumed: true };
}
