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

function isTruthySetting(settingValue) {
  if (settingValue == null) return false;
  const v = String(settingValue).trim().toUpperCase();
  return v === 'TRUE' || v === 'YES' || v === '1';
}

export function isVotingOpen(settingValue) {
  if (!settingValue) return false;
  return isTruthySetting(settingValue);
}

export function parseSeasonId(value) {
  if (value == null) return null;
  const n = parseInt(String(value).replace(/\D/g, ''), 10);
  return Number.isNaN(n) ? null : n;
}

export function parseWeek(value) {
  if (value == null) return null;
  const n = parseInt(String(value).replace(/\D/g, ''), 10);
  return Number.isNaN(n) ? null : n;
}

export function isSeasonStarted(settingValue) {
  if (settingValue == null) return false;
  return isTruthySetting(settingValue);
}

export function isSeasonPaused(settingValue) {
  if (settingValue == null) return false;
  return isTruthySetting(settingValue);
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

// Award helpers
export async function getAwardsForSeason(db, seasonId) {
  return db.prepare(
    'SELECT * FROM awards WHERE season_id = ? ORDER BY award_name'
  ).bind(seasonId).all();
}

// Player lookup by Melee name
export async function findPlayerByMelee(db, meleeName) {
  const row = await db.prepare(
    'SELECT id FROM players WHERE LOWER(melee_name) = LOWER(?)'
  ).bind(meleeName).first();
  return row ? row.id : null;
}

// Duplicate vote check
export async function hasPlayerVotedThisWeek(db, seasonId, week, playerId) {
  const row = await db.prepare(
    'SELECT 1 FROM votes WHERE season_id = ? AND week = ? AND player_id = ?'
  ).bind(seasonId, week, playerId).first();
  return !!row;
}

// Most played leaders
export async function getMostPlayedLeaders(db, seasonId) {
  return db.prepare(`
    SELECT l.id, l.name, l."set", COUNT(v.id) as play_count
    FROM votes v
    JOIN leaders l ON v.leader_id = l.id
    WHERE v.season_id = ?
    GROUP BY l.id, l.name, l."set"
    ORDER BY play_count DESC
    LIMIT 50
  `).bind(seasonId).all();
}
