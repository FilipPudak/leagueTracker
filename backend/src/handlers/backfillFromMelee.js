import { backfillFromMelee } from '../triggers/backfillFromMelee.js';
import { requireAdmin } from '../lib/auth.js';

export async function handleBackfillFromMelee(body, env) {
  requireAdmin(body, env);

  const result = await backfillFromMelee(env, {
    seasonId: body.seasonId || null,
    maxTournaments: body.maxTournaments || undefined,
    resync: body.resync || false,
    allowActiveSeason: body.allowActiveSeason || false,
  });
  return result;
}
