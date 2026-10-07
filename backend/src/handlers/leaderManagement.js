import { requireAdmin } from '../lib/auth.js';
import { badRequest } from '../lib/errors.js';

export async function handleAddLeaders(body, env) {
  const { DB } = env;
  requireAdmin(body, env);
  const { leaders } = body;

  if (!Array.isArray(leaders)) throw badRequest('leaders must be an array.');

  const existing = await DB.prepare('SELECT name, "set" FROM leaders').all();
  const existingLeaders = (existing.results || []).map(l => ({
    name: l.name.toLowerCase(),
    set: (l.set || '').toLowerCase(),
  }));

  const added = [];
  const skipped = [];

  for (const leader of leaders) {
    if (!leader || !leader.name) {
      skipped.push({ name: leader?.name || '(unnamed)', reason: 'missing name' });
      continue;
    }
    const name = leader.name.toLowerCase();
    const set = (leader.set || '').toLowerCase();
    const isDuplicate = existingLeaders.some(e =>
      e.name === name && (!e.set || !set || e.set === set)
    );
    if (isDuplicate) {
      skipped.push({ name: leader.name, reason: 'duplicate' });
      continue;
    }

    const id = crypto.randomUUID();

    await DB.prepare(
      'INSERT INTO leaders (id, name, "set", active) VALUES (?, ?, ?, 1)'
    ).bind(id, leader.name, leader.set || null).run();

    added.push({ id, name: leader.name, set: leader.set });
    existingLeaders.push({ name, set });
  }

  return { added, skipped };
}

export async function handleSetLeadersActive(body, env) {
  const { DB } = env;
  requireAdmin(body, env);
  const { leaderIds, active } = body;

  if (!Array.isArray(leaderIds)) throw badRequest('leaderIds must be an array.');

  for (const id of leaderIds) {
    await DB.prepare('UPDATE leaders SET active = ? WHERE id = ?').bind(active ? 1 : 0, id).run();
  }

  return { updated: leaderIds.length };
}

export async function handleRemoveLeaders(body, env) {
  const { DB } = env;
  requireAdmin(body, env);
  const { leaderIds } = body;

  if (!Array.isArray(leaderIds)) throw badRequest('leaderIds must be an array.');

  const removed = [];
  const refused = [];

  for (const id of leaderIds) {
    const referenced = await DB.prepare(
      'SELECT 1 FROM votes WHERE leader_id = ? LIMIT 1'
    ).bind(id).first();

    if (referenced) {
      const leader = await DB.prepare('SELECT name FROM leaders WHERE id = ?').bind(id).first();
      refused.push({ id, name: leader?.name || id, reason: 'referenced by votes' });
      continue;
    }

    await DB.prepare('DELETE FROM leaders WHERE id = ?').bind(id).run();
    removed.push(id);
  }

  return { removed, refused };
}
