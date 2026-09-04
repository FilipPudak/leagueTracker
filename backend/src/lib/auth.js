const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

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
  await db.prepare(
    "UPDATE sessions SET last_active = datetime('now') WHERE token = ?"
  ).bind(token).run();
}

export async function createSession(db, playerId, deviceId, email) {
  // Generate UUID token
  const token = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.prepare(
    'INSERT OR REPLACE INTO sessions (token, player_id, device_id, email, created, last_active) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(token, playerId, deviceId, email || '', now, now).run();
  return token;
}

export async function deleteSessionsByPlayerAndDevice(db, playerId, deviceId) {
  await db.prepare(
    'DELETE FROM sessions WHERE player_id = ? AND device_id = ?'
  ).bind(playerId, deviceId).run();
}

export async function deleteSessionByToken(db, token) {
  await db.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
}
