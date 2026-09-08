-- D1 schema migration
-- Applied via: wrangler d1 execute league-tracker --remote --file=schema.sql

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
  melee_guid TEXT,
  email TEXT,
  active INTEGER DEFAULT 1
);

-- Leader options (replaces Leaders sheet)
CREATE TABLE IF NOT EXISTS leaders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  "set" TEXT,
  active INTEGER INTEGER DEFAULT 1
);

-- Season registry (replaces Seasons sheet)
CREATE TABLE IF NOT EXISTS seasons (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  created_date TEXT,
  length INTEGER NOT NULL DEFAULT 11,
  top_results INTEGER NOT NULL DEFAULT 7
);

-- Session tokens (replaces Sessions sheet)
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  email TEXT,
  created TEXT NOT NULL,
  last_active TEXT NOT NULL,
  FOREIGN KEY (player_id) REFERENCES players(id),
  UNIQUE(player_id, device_id)
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

-- Merged votes table (replaces leader_votes + opponent_votes)
CREATE TABLE IF NOT EXISTS votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  updated_at TEXT,
  season_id INTEGER NOT NULL,
  week INTEGER NOT NULL,
  player_id TEXT NOT NULL,
  leader_id TEXT NOT NULL,
  opponent_id TEXT NOT NULL,
  FOREIGN KEY (season_id) REFERENCES seasons(id),
  FOREIGN KEY (player_id) REFERENCES players(id),
  FOREIGN KEY (leader_id) REFERENCES leaders(id),
  FOREIGN KEY (opponent_id) REFERENCES players(id),
  UNIQUE(season_id, week, player_id)
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
CREATE INDEX IF NOT EXISTS idx_attendance_season_player ON attendance(season_id, player_id);
CREATE INDEX IF NOT EXISTS idx_votes_season_week ON votes(season_id, week);
CREATE INDEX IF NOT EXISTS idx_votes_player ON votes(player_id);

-- Melee.gg tournament mapping
CREATE TABLE IF NOT EXISTS melee_tournaments (
  melee_id INTEGER PRIMARY KEY,
  season_id INTEGER NOT NULL,
  round INTEGER NOT NULL,
  name TEXT NOT NULL,
  date TEXT,
  phase TEXT NOT NULL DEFAULT 'regular',
  FOREIGN KEY (season_id) REFERENCES seasons(id),
  UNIQUE(season_id, round)
);

-- Season standings from Melee.gg
CREATE TABLE IF NOT EXISTS season_standings (
  season_id INTEGER NOT NULL,
  round INTEGER NOT NULL,
  player_id TEXT NOT NULL,
  wins INTEGER DEFAULT 0,
  losses INTEGER DEFAULT 0,
  draws INTEGER DEFAULT 0,
  match_points INTEGER DEFAULT 0,
  rank INTEGER,
  PRIMARY KEY (season_id, round, player_id),
  FOREIGN KEY (season_id) REFERENCES seasons(id),
  FOREIGN KEY (player_id) REFERENCES players(id)
);

-- Match results from Melee.gg
CREATE TABLE IF NOT EXISTS match_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  season_id INTEGER NOT NULL,
  round INTEGER NOT NULL,
  melee_match_id TEXT,
  player1_id TEXT NOT NULL,
  player2_id TEXT NOT NULL,
  winner_id TEXT,
  result TEXT,
  is_bye INTEGER DEFAULT 0,
  FOREIGN KEY (season_id) REFERENCES seasons(id),
  FOREIGN KEY (player1_id) REFERENCES players(id),
  FOREIGN KEY (player2_id) REFERENCES players(id),
  UNIQUE(season_id, round, melee_match_id)
);

CREATE INDEX IF NOT EXISTS idx_melee_tournaments_season ON melee_tournaments(season_id);
CREATE INDEX IF NOT EXISTS idx_season_standings_season ON season_standings(season_id, round);
CREATE INDEX IF NOT EXISTS idx_match_results_season ON match_results(season_id, round);
