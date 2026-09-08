const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

export function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export async function findSessionByToken(db, token) {
  if (!token) return null;
  const row = await db.prepare(
    'SELECT * FROM sessions WHERE token = ?'
  ).bind(token).first();
  if (!row) return null;

  // Check TTL expiry
  const lastActive = new Date(row.last_active);
  const now = new Date();
  if (now - lastActive > SESSION_TTL_MS) {
    // Session expired — delete it
    await db.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
    return null;
  }

  // Verify player still exists and is active
  const player = await db.prepare(
    'SELECT id, active FROM players WHERE id = ?'
  ).bind(row.player_id).first();
  if (!player || player.active !== 1) {
    await db.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
    return null;
  }

  // Verify email still belongs to this player (admin may have cleared/changed it)
  const sessionEmail = (row.email || '').toLowerCase().trim();
  if (sessionEmail) {
    const emailOwner = await db.prepare(
      'SELECT id FROM players WHERE LOWER(email) = LOWER(?)'
    ).bind(sessionEmail).first();
    if (!emailOwner || String(emailOwner.id) !== String(row.player_id)) {
      await db.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
      return null;
    }
  }

  return row;
}

export async function findSessionByPlayerAndDevice(db, playerId, deviceId) {
  const row = await db.prepare(
    'SELECT * FROM sessions WHERE player_id = ? AND device_id = ?'
  ).bind(playerId, deviceId).first();
  if (!row) return null;

  // Check TTL expiry
  const lastActive = new Date(row.last_active);
  const now = new Date();
  if (now - lastActive > SESSION_TTL_MS) {
    await db.prepare('DELETE FROM sessions WHERE token = ?').bind(row.token).run();
    return null;
  }
  return row;
}

export async function touchSessionTimestamp(db, token) {
  if (!token) return;
  await db.prepare(
    "UPDATE sessions SET last_active = datetime('now') WHERE token = ?"
  ).bind(token).run();
}

export async function createSession(db, playerId, deviceId, email) {
  // Delete any existing session for this (player, device) pair (UNIQUE constraint safety net)
  await db.prepare(
    'DELETE FROM sessions WHERE player_id = ? AND device_id = ?'
  ).bind(playerId, deviceId).run();

  const token = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.prepare(
    'INSERT INTO sessions (token, player_id, device_id, email, created, last_active) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(token, playerId, deviceId, email || '', now, now).run();
  return token;
}

export async function deleteSessionsByPlayerAndDevice(db, playerId, deviceId) {
  await db.prepare(
    'DELETE FROM sessions WHERE player_id = ? AND device_id = ?'
  ).bind(playerId, deviceId).run();
}
