import { requireAdmin } from '../lib/auth.js';
import { countHeldRows } from '../lib/playerMerge.js';

// What approval would move: an email-bearing holder blocks the rename, an
// email-less holder gets absorbed. The admin needs that before approving —
// the queue is the only review surface.
async function resolveHolders(DB, request) {
  const result = await DB.prepare(
    'SELECT id, name, email FROM players WHERE LOWER(melee_name) = LOWER(?)'
  ).bind(request.new_melee_name).all();
  const others = (result.results || []).filter((row) => row.id !== request.player_id);
  const conflict = others.find((row) => row.email) || null;
  const mergeTargets = [];
  for (const row of others) {
    if (row.email) continue;
    mergeTargets.push({ playerId: row.id, name: row.name, rows: await countHeldRows(DB, row.id) });
  }
  return { conflict, mergeTargets };
}

export async function handleListRenameRequests(body, env) {
  requireAdmin(body, env);
  const result = await env.DB.prepare(
    'SELECT * FROM rename_requests ORDER BY requested_at DESC'
  ).all();
  const requests = [];
  for (const row of result.results || []) {
    const { conflict, mergeTargets } = row.status === 'pending'
      ? await resolveHolders(env.DB, row)
      : { conflict: null, mergeTargets: [] };
    requests.push({
      id: row.id,
      playerId: row.player_id,
      oldMeleeName: row.old_melee_name,
      newMeleeName: row.new_melee_name,
      status: row.status,
      meleeHint: row.melee_hint,
      requestedAt: row.requested_at,
      resolvedAt: row.resolved_at,
      resolvedBy: row.resolved_by,
      note: row.note,
      conflictPlayerId: conflict ? conflict.id : null,
      mergeTargets,
    });
  }
  return { requests };
}
