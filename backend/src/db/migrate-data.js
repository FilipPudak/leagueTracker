// Data migration: CSV → D1
// Usage: node migrate.js

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP_DIR = join(__dirname, '..', '..', '..', 'tmp');

function parseCSV(filePath) {
  let content = readFileSync(filePath, 'utf-8');
  // Remove BOM if present
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
  content = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = content.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    const row = {};
    headers.forEach((h, idx) => { row[h] = values[idx] || ''; });
    rows.push(row);
  }
  return rows;
}

function extractSeasonNumber(s) {
  if (!s) return null;
  const num = parseInt(String(s).replace(/\D/g, ''), 10);
  return isNaN(num) ? null : num;
}

function sqlEscape(val) {
  if (val === null || val === undefined || val === '') return 'NULL';
  return "'" + String(val).replace(/'/g, "''") + "'";
}

function boolToInt(val) {
  return val && String(val).toUpperCase() === 'TRUE' ? 1 : 0;
}

export function generateSQL() {
  const statements = [];

  // 1. Settings
  const settings = parseCSV(join(TMP_DIR, 'SWU DL League Sheets - Settings.csv'));
  for (const row of settings) {
    const key = row['Setting'] || row['Key'];
    const value = row['Value'];
    if (key) {
      statements.push(`INSERT OR REPLACE INTO settings (key, value) VALUES (${sqlEscape(key)}, ${sqlEscape(value)});`);
    }
  }

  // 2. Players
  const players = parseCSV(join(TMP_DIR, 'SWU DL League Sheets - Players.csv'));
  for (const row of players) {
    const id = row['Player ID'];
    const name = row['Player Name'];
    const meleeName = row['Melee Name'];
    const email = row['Google Account'] || row['Google Email'] || '';
    const active = boolToInt(row['Active']);
    if (id && name) {
      statements.push(`INSERT OR REPLACE INTO players (id, name, melee_name, email, active) VALUES (${sqlEscape(id)}, ${sqlEscape(name)}, ${sqlEscape(meleeName)}, ${sqlEscape(email.toLowerCase())}, ${active});`);
    }
  }

  // 3. Leaders
  const leaders = parseCSV(join(TMP_DIR, 'SWU DL League Sheets - Leaders.csv'));
  for (const row of leaders) {
    const id = row['Leader ID'];
    const name = row['Leader Name'];
    const set = row['Set'];
    const active = boolToInt(row['Active']);
    if (id && name) {
      statements.push(`INSERT OR REPLACE INTO leaders (id, name, "set", active) VALUES (${sqlEscape(id)}, ${sqlEscape(name)}, ${sqlEscape(set)}, ${active});`);
    }
  }

  // 4. Seasons
  const seasons = parseCSV(join(TMP_DIR, 'SWU DL League Sheets - Seasons.csv'));
  for (const row of seasons) {
    const rawId = row['Season ID'];
    const id = extractSeasonNumber(rawId);
    const name = row['Season Name'];
    const createdDate = row['Start Date'] || row['Created Date'] || '';
    if (id && name) {
      statements.push(`INSERT OR REPLACE INTO seasons (id, name, created_date) VALUES (${id}, ${sqlEscape(name)}, ${sqlEscape(createdDate)});`);
    }
  }

  // 5. LeaderVotes (may be empty)
  const leaderVotes = parseCSV(join(TMP_DIR, 'SWU DL League Sheets - LeaderVotes.csv'));
  for (const row of leaderVotes) {
    const timestamp = row['Timestamp'];
    const seasonId = extractSeasonNumber(row['Season ID']);
    const week = parseInt(row['Week'], 10);
    const playerId = row['Player ID'];
    const leaderId = row['Leader ID'];
    if (seasonId && week && playerId && leaderId) {
      statements.push(`INSERT OR IGNORE INTO leader_votes (timestamp, season_id, week, player_id, leader_id) VALUES (${sqlEscape(timestamp)}, ${seasonId}, ${week}, ${sqlEscape(playerId)}, ${sqlEscape(leaderId)});`);
    }
  }

  // 6. OpponentVotes (may be empty)
  const opponentVotes = parseCSV(join(TMP_DIR, 'SWU DL League Sheets - OpponentVotes.csv'));
  for (const row of opponentVotes) {
    const timestamp = row['Timestamp'];
    const seasonId = extractSeasonNumber(row['Season ID']);
    const week = parseInt(row['Week'], 10);
    const opponentId = row['Favorite Opponent ID'] || row['Opponent ID'];
    if (seasonId && week && opponentId) {
      statements.push(`INSERT OR IGNORE INTO opponent_votes (timestamp, season_id, week, opponent_id) VALUES (${sqlEscape(timestamp)}, ${seasonId}, ${week}, ${sqlEscape(opponentId)});`);
    }
  }

  // 7. Awards
  const awards = parseCSV(join(TMP_DIR, 'SWU DL League Sheets - Awards.csv'));
  for (const row of awards) {
    const seasonId = extractSeasonNumber(row['Season ID']);
    const awardName = row['Award'];
    const playerId = row['Player ID'];
    const score = row['Score'] ? Number(row['Score']) : null;
    if (seasonId && awardName) {
      statements.push(`INSERT OR REPLACE INTO awards (season_id, award_name, player_id, score) VALUES (${seasonId}, ${sqlEscape(awardName)}, ${sqlEscape(playerId)}, ${score !== null ? score : 'NULL'});`);
    }
  }

  // 8. Sessions
  const sessions = parseCSV(join(TMP_DIR, 'SWU DL League Sheets - Sessions.csv'));
  for (const row of sessions) {
    const token = row['TOKEN'] || row['Token'];
    const playerId = row['PLAYER_ID'] || row['Player ID'];
    const deviceId = row['DEVICE_ID'] || row['Device ID'];
    const email = (row['EMAIL'] || row['Email'] || '').trim().toLowerCase();
    const created = row['CREATED'] || row['Created'] || '';
    const lastActive = row['LAST_ACTIVE'] || row['Last Active'] || '';
    if (token && playerId) {
      const la = lastActive || created || new Date().toISOString();
      statements.push(`INSERT OR REPLACE INTO sessions (token, player_id, device_id, email, created, last_active) VALUES (${sqlEscape(token)}, ${sqlEscape(playerId)}, ${sqlEscape(deviceId)}, ${sqlEscape(email)}, ${sqlEscape(created)}, ${sqlEscape(la)});`);
    }
  }

  return statements.join('\n');
}

// Run directly
if (process.argv[1] && process.argv[1].endsWith('migrate-data.js')) {
  const sql = generateSQL();
  const outPath = join(__dirname, 'data.sql');
  writeFileSync(outPath, sql, 'utf-8');
  console.log(`Generated ${sql.split('\n').filter(l => l.trim()).length} SQL statements → ${outPath}`);
}
