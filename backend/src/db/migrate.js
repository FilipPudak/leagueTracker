// D1 schema migration script
// Usage: wrangler d1 execute league-tracker --file=src/db/migrate.js

export const schema = `
-- Runtime configuration (replaces Settings sheet)
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Player roster (replaces Players sheet)
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  melee_name TEXT,
  email TEXT,
  active INTEGER DEFAULT 1
);

-- Leader options (replaces Leaders sheet)
CREATE TABLE IF NOT EXISTS leaders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  "set" TEXT,
  active INTEGER DEFAULT 1
);

-- Season registry (replaces Seasons sheet)
CREATE TABLE IF NOT EXISTS seasons (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  created_date TEXT
);

-- Session tokens (replaces Sessions sheet)
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  email TEXT,
  created TEXT NOT NULL,
  last_active TEXT NOT NULL,
  FOREIGN KEY (player_id) REFERENCES players(id)
);

-- Weekly votes: leader played (replaces LeaderVotes sheet)
CREATE TABLE IF NOT EXISTS leader_votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  season_id INTEGER NOT NULL,
  week INTEGER NOT NULL,
  player_id TEXT NOT NULL,
  leader_id TEXT NOT NULL,
  FOREIGN KEY (season_id) REFERENCES seasons(id),
  FOREIGN KEY (player_id) REFERENCES players(id),
  FOREIGN KEY (leader_id) REFERENCES leaders(id),
  UNIQUE(season_id, week, player_id)
);

-- Weekly votes: favorite opponent (replaces OpponentVotes sheet)
CREATE TABLE IF NOT EXISTS opponent_votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  season_id INTEGER NOT NULL,
  week INTEGER NOT NULL,
  opponent_id TEXT NOT NULL,
  FOREIGN KEY (season_id) REFERENCES seasons(id),
  FOREIGN KEY (opponent_id) REFERENCES players(id)
);

-- Materialized award podium (replaces Awards sheet)
CREATE TABLE IF NOT EXISTS awards (
  season_id INTEGER NOT NULL,
  award_name TEXT NOT NULL,
  player_id TEXT NOT NULL,
  score REAL,
  PRIMARY KEY (season_id, award_name, player_id),
  FOREIGN KEY (season_id) REFERENCES seasons(id),
  FOREIGN KEY (player_id) REFERENCES players(id)
);

-- Attendance tracking (NEW - inferred from SWU site standings)
CREATE TABLE IF NOT EXISTS attendance (
  season_id INTEGER NOT NULL,
  week INTEGER NOT NULL,
  player_id TEXT NOT NULL,
  FOREIGN KEY (season_id) REFERENCES seasons(id),
  FOREIGN KEY (player_id) REFERENCES players(id),
  PRIMARY KEY (season_id, week, player_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_leader_votes_season_week ON leader_votes(season_id, week);
CREATE INDEX IF NOT EXISTS idx_leader_votes_player ON leader_votes(player_id);
CREATE INDEX IF NOT EXISTS idx_opponent_votes_season_week ON opponent_votes(season_id, week);
CREATE INDEX IF NOT EXISTS idx_sessions_player ON sessions(player_id);
CREATE INDEX IF NOT EXISTS idx_sessions_device ON sessions(device_id);
CREATE INDEX IF NOT EXISTS idx_attendance_season ON attendance(season_id, week);
`;

// For local dev: run directly with Node
if (typeof process !== 'undefined' && process.argv[1] && process.argv[1].endsWith('migrate.js')) {
  console.log('Schema SQL:');
  console.log(schema);
  console.log('\nTo apply to D1, run:');
  console.log('wrangler d1 execute league-tracker --file=src/db/migrate.js');
}
