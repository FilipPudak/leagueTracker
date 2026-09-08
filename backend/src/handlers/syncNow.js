import { constantTimeEqual } from '../lib/auth.js';
import { syncFromMelee } from '../triggers/syncFromMelee.js';

export async function handleSyncNow(body, env) {
  const { DB, ADMIN_SECRET } = env;
  const { adminToken } = body;

  if (!adminToken || !constantTimeEqual(adminToken, ADMIN_SECRET || '')) {
    const err = new Error('Unauthorized. Invalid admin token.');
    err.status = 403;
    throw err;
  }

  await syncFromMelee({ DB });

  return { synced: true };
}
