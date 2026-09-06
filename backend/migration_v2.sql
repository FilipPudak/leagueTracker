-- v2: Add UNIQUE(player_id, device_id) constraint to sessions table.
-- SQLite doesn't support ALTER TABLE ADD CONSTRAINT, so we rebuild the table.
-- Usage: wrangler d1 execute league-tracker --remote --file=migration_v2.sql

CREATE TABLE IF NOT EXISTS sessions_new (
  token TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  email TEXT,
  created TEXT NOT NULL,
  last_active TEXT NOT NULL,
  FOREIGN KEY (player_id) REFERENCES players(id),
  UNIQUE(player_id, device_id)
);

INSERT OR IGNORE INTO sessions_new (token, player_id, device_id, email, created, last_active)
  SELECT token, player_id, device_id, email, created, last_active
  FROM sessions
  ORDER BY last_active DESC;

DROP TABLE sessions;

ALTER TABLE sessions_new RENAME TO sessions;

CREATE INDEX IF NOT EXISTS idx_sessions_player ON sessions(player_id);
CREATE INDEX IF NOT EXISTS idx_sessions_device ON sessions(device_id);
