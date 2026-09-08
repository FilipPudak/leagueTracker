-- M2 schema migration
-- Applied via: wrangler d1 execute league-tracker --remote --file=backend/migrations/M2.sql

-- seasons: add length and top_results columns
ALTER TABLE seasons ADD COLUMN length INTEGER NOT NULL DEFAULT 11;
ALTER TABLE seasons ADD COLUMN top_results INTEGER NOT NULL DEFAULT 7;

-- melee_tournaments: add phase column and UNIQUE constraint
-- SQLite doesn't support ALTER TABLE ADD CONSTRAINT, so we rebuild the table
ALTER TABLE melee_tournaments ADD COLUMN phase TEXT NOT NULL DEFAULT 'regular';

CREATE TABLE IF NOT EXISTS melee_tournaments_new (
  melee_id INTEGER PRIMARY KEY,
  season_id INTEGER NOT NULL,
  round INTEGER NOT NULL,
  name TEXT NOT NULL,
  date TEXT,
  phase TEXT NOT NULL DEFAULT 'regular',
  FOREIGN KEY (season_id) REFERENCES seasons(id),
  UNIQUE(season_id, round)
);

INSERT OR IGNORE INTO melee_tournaments_new (melee_id, season_id, round, name, date, phase)
  SELECT melee_id, season_id, round, name, date, COALESCE(phase, 'regular')
  FROM melee_tournaments;

DROP TABLE melee_tournaments;
ALTER TABLE melee_tournaments_new RENAME TO melee_tournaments;

CREATE INDEX IF NOT EXISTS idx_melee_tournaments_season ON melee_tournaments(season_id);

-- match_results: recreate with UNIQUE constraint and melee_match_id as TEXT
-- SQLite doesn't support ALTER TABLE ADD CONSTRAINT or ALTER COLUMN
CREATE TABLE IF NOT EXISTS match_results_new (
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

INSERT OR IGNORE INTO match_results_new (id, season_id, round, melee_match_id, player1_id, player2_id, winner_id, result, is_bye)
  SELECT id, season_id, round, CAST(melee_match_id AS TEXT), player1_id, player2_id, winner_id, result, is_bye
  FROM match_results;

DROP TABLE match_results;
ALTER TABLE match_results_new RENAME TO match_results;

CREATE INDEX IF NOT EXISTS idx_match_results_season ON match_results(season_id, round);

-- Create new votes table (replaces leader_votes + opponent_votes)
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

-- Add indexes for votes table
CREATE INDEX IF NOT EXISTS idx_votes_season_week ON votes(season_id, week);
CREATE INDEX IF NOT EXISTS idx_votes_player ON votes(player_id);

-- Drop old vote tables (empty, zero migration)
DROP TABLE IF EXISTS leader_votes;
DROP TABLE IF EXISTS opponent_votes;

-- Drop old indexes for removed tables
DROP INDEX IF EXISTS idx_leader_votes_season_week;
DROP INDEX IF EXISTS idx_leader_votes_player;
DROP INDEX IF EXISTS idx_opponent_votes_season_week;

-- Backfill seasons.length and top_results per CONTEXT §5
UPDATE seasons SET length = 10, top_results = 7 WHERE id = 1;
UPDATE seasons SET length = 15, top_results = 10 WHERE id = 2;
UPDATE seasons SET length = 15, top_results = 10 WHERE id = 3;
UPDATE seasons SET length = 15, top_results = 10 WHERE id = 4;
UPDATE seasons SET length = 11, top_results = 7 WHERE id = 5;
UPDATE seasons SET length = 11, top_results = 7 WHERE id = 6;
UPDATE seasons SET length = 11, top_results = 7 WHERE id = 7;
