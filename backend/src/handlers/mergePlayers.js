import { requireAdmin } from '../lib/auth.js';
import { badRequest } from '../lib/errors.js';
import { buildMergePlan, mergeNote } from '../lib/playerMerge.js';

export async function handleMergePlayers(body, env) {
  requireAdmin(body, env);
  const { DB } = env;

  const { survivorId, orphanId } = body;
  if (!survivorId || !orphanId) throw badRequest('survivorId and orphanId are required.');
  if (survivorId === orphanId) throw badRequest('survivorId and orphanId must differ.');

  const plan = await buildMergePlan(DB, survivorId, [orphanId]);
  if (!plan) throw badRequest('Player not found.');

  await DB.batch(plan.statements);

  return {
    survivorId,
    orphanId,
    summary: plan.summary,
    note: mergeNote(plan.summary),
  };
}
