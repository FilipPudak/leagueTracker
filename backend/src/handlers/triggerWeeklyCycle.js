import { requireAdmin } from '../lib/auth.js';
import { syncFromMelee } from '../triggers/syncFromMelee.js';

export async function handleTriggerWeeklyCycle(body, env) {
  requireAdmin(body, env);

  const runSync = env.syncFromMelee || syncFromMelee;
  const result = await runSync(env);

  return { synced: true, result: result || { status: 'ok' } };
}
