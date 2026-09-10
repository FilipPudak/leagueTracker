import { constantTimeEqual } from '../lib/auth.js';
import { badRequest } from '../lib/errors.js';

export async function handleAddLeaders(body, env) {
  const { DB, ADMIN_SECRET } = env;
  const { adminToken, leaders } = body;

  if (!adminToken || !constantTimeEqual(adminToken, ADMIN_SECRET || '')) {
    const err = new Error('Unauthorized. Invalid admin token.');
    err.status = 403;
    throw err;
  }

  if (!Array.isArray(leaders)) throw badRequest('leaders must be an array.');

  const existing = await DB.prepare('SELECT name FROM leaders').all();
  const existingNames = new Set((existing.results || []).map(l => l.name.toLowerCase()));

  const added = [];
  const skipped = [];

  for (const leader of leaders) {
    if (!leader || !leader.name) {
      skipped.push({ name: leader?.name || '(unnamed)', reason: 'missing name' });
      continue;
    }
    if (existingNames.has(leader.name.toLowerCase())) {
      skipped.push({ name: leader.name, reason: 'duplicate' });
      continue;
    }

    const id = crypto.randomUUID();

    await DB.prepare(
      'INSERT INTO leaders (id, name, "set", active) VALUES (?, ?, ?, 1)'
    ).bind(id, leader.name, leader.set || null).run();

    added.push({ id, name: leader.name, set: leader.set });
    existingNames.add(leader.name.toLowerCase());
  }

  return { added, skipped };
}

export async function handleSetLeadersActive(body, env) {
  const { DB, ADMIN_SECRET } = env;
  const { adminToken, leaderIds, active } = body;

  if (!adminToken || !constantTimeEqual(adminToken, ADMIN_SECRET || '')) {
    const err = new Error('Unauthorized. Invalid admin token.');
    err.status = 403;
    throw err;
  }

  if (!Array.isArray(leaderIds)) throw badRequest('leaderIds must be an array.');

  for (const id of leaderIds) {
    await DB.prepare('UPDATE leaders SET active = ? WHERE id = ?').bind(active ? 1 : 0, id).run();
  }

  return { updated: leaderIds.length };
}

export async function handleRemoveLeaders(body, env) {
  const { DB, ADMIN_SECRET } = env;
  const { adminToken, leaderIds } = body;

  if (!adminToken || !constantTimeEqual(adminToken, ADMIN_SECRET || '')) {
    const err = new Error('Unauthorized. Invalid admin token.');
    err.status = 403;
    throw err;
  }

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
