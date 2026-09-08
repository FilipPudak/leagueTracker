import { backfillFromMelee } from '../triggers/backfillFromMelee.js';
import { constantTimeEqual } from '../lib/auth.js';

export async function handleBackfillFromMelee(body, env) {
  const { adminToken, seasonId } = body;

  if (!adminToken || !constantTimeEqual(adminToken, env.ADMIN_SECRET || '')) {
    const err = new Error('Unauthorized. Invalid admin token.');
    err.status = 403;
    throw err;
  }

  const result = await backfillFromMelee(env, { seasonId: seasonId || null, maxTournaments: body.maxTournaments || undefined });
  return result;
}
