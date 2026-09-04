// Settings helpers
export async function getSettings(db) {
  const rows = await db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const row of rows.results) {
    settings[row.key] = row.value;
  }
  return settings;
}

export async function getSetting(db, key) {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
  return row ? row.value : null;
}

export async function updateSetting(db, key, value) {
  await db.prepare(
    'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'
  ).bind(key, String(value)).run();
}

// Player helpers
export async function getPlayerById(db, id) {
  return db.prepare('SELECT * FROM players WHERE id = ?').bind(id).first();
}

export async function getPlayerByEmail(db, email) {
  if (!email) return null;
  return db.prepare(
    'SELECT * FROM players WHERE LOWER(email) = LOWER(?)'
  ).bind(email).first();
}

export async function getAllActivePlayers(db) {
  return db.prepare('SELECT * FROM players WHERE active = 1 ORDER BY name').all();
}

// Leader helpers
export async function getAllActiveLeaders(db) {
  return db.prepare('SELECT * FROM leaders WHERE active = 1 ORDER BY name').all();
}

// Season helpers
export async function getSeasonById(db, id) {
  return db.prepare('SELECT * FROM seasons WHERE id = ?').bind(id).first();
}

export async function getAllSeasons(db) {
  return db.prepare('SELECT * FROM seasons ORDER BY id DESC').all();
}

export async function getMaxSeasonId(db) {
  const row = await db.prepare('SELECT MAX(id) as max_id FROM seasons').first();
  return row ? row.max_id || 0 : 0;
}

// Vote helpers
export async function hasSubmittedThisWeek(db, seasonId, week, playerId) {
  const row = await db.prepare(
    'SELECT 1 FROM leader_votes WHERE season_id = ? AND week = ? AND player_id = ?'
  ).bind(seasonId, week, playerId).first();
  return !!row;
}

// Session helpers
export async function getSessionByToken(db, token) {
  if (!token) return null;
  return db.prepare('SELECT * FROM sessions WHERE token = ?').bind(token).first();
}

// Award helpers
export async function getAwardsForSeason(db, seasonId) {
  return db.prepare(
    'SELECT * FROM awards WHERE season_id = ? ORDER BY award_name'
  ).bind(seasonId).all();
}

// Most played leaders
export async function getMostPlayedLeaders(db, seasonId) {
  return db.prepare(`
    SELECT l.id, l.name, l."set", COUNT(lv.id) as play_count
    FROM leader_votes lv
    JOIN leaders l ON lv.leader_id = l.id
    WHERE lv.season_id = ?
    GROUP BY l.id, l.name, l."set"
    ORDER BY play_count DESC
    LIMIT 10
  `).bind(seasonId).all();
}
