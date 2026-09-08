-- M2 schema migration
-- Applied via: wrangler d1 execute league-tracker --remote --file=backend/migrations/M2.sql

-- seasons: add length and top_results columns
ALTER TABLE seasons ADD COLUMN length INTEGER NOT NULL DEFAULT 11;
ALTER TABLE seasons ADD COLUMN top_results INTEGER NOT NULL DEFAULT 7;

-- melee_tournaments: add phase column and UNIQUE constraint
ALTER TABLE melee_tournaments ADD COLUMN phase TEXT NOT NULL DEFAULT 'regular';

-- match_results: add UNIQUE constraint (melee_match_id is already TEXT)
-- Note: SQLite doesn't support adding UNIQUE constraints via ALTER TABLE
-- We need to recreate the table with the constraint

-- Create new votes table
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

-- Backfill seasons.length and top_results per CONTEXT §5
UPDATE seasons SET length = 10, top_results = 7 WHERE id = 1;
UPDATE seasons SET length = 15, top_results = 10 WHERE id = 2;
UPDATE seasons SET length = 15, top_results = 10 WHERE id = 3;
UPDATE seasons SET length = 15, top_results = 10 WHERE id = 4;
UPDATE seasons SET length = 11, top_results = 7 WHERE id = 5;
UPDATE seasons SET length = 11, top_results = 7 WHERE id = 6;
UPDATE seasons SET length = 11, top_results = 7 WHERE id = 7;
