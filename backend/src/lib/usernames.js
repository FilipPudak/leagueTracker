import { badRequest } from './errors.js';

const MELEE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{2,24}$/;

export function normalizeMeleeName(value) {
  if (typeof value !== 'string') {
    throw badRequest('A Melee username is required.');
  }
  const name = value.trim();
  if (!MELEE_NAME_RE.test(name)) {
    throw badRequest('Melee username must be 3-25 characters: letters, numbers, dot, dash or underscore, starting with a letter or number.');
  }
  return name;
}

export async function findPlayersByMeleeName(DB, meleeName) {
  const result = await DB.prepare(
    'SELECT * FROM players WHERE LOWER(melee_name) = LOWER(?)'
  ).bind(meleeName).all();
  return result.results || [];
}

// Insert-then-refresh: the row is keyed by (player_id, name_lower) so the same
// handle in two casings cannot become two history rows (which would make a
// lookup ambiguous and spawn an orphan); the follow-up UPDATE refreshes the
// stored casing and last_seen.
export function historyStatements(DB, { playerId, meleeName, source, firstSeen = null }) {
  const now = new Date().toISOString();
  const nameLower = meleeName.toLowerCase();
  return [
    DB.prepare(
      'INSERT OR IGNORE INTO player_usernames (player_id, melee_name, name_lower, source, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(playerId, meleeName, nameLower, source, firstSeen, now),
    DB.prepare(
      'UPDATE player_usernames SET melee_name = ?, last_seen = ? WHERE player_id = ? AND name_lower = ?'
    ).bind(meleeName, now, playerId, nameLower),
  ];
}
