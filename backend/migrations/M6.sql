-- M6: multi-username support — username history + rename request queue.
-- Applied via: npx wrangler d1 execute <D1_DATABASE_ID> --remote --file=backend/migrations/M6.sql
-- (the database id is in docs/DEPLOYMENT.md; `league-tracker` is rejected for D1 calls)
-- Re-runnable: every statement is IF NOT EXISTS / OR IGNORE.

CREATE TABLE IF NOT EXISTS player_usernames (
  player_id   TEXT NOT NULL,
  melee_name  TEXT NOT NULL,
  name_lower  TEXT NOT NULL,
  source      TEXT NOT NULL,
  first_seen  TEXT,
  last_seen   TEXT NOT NULL,
  PRIMARY KEY (player_id, name_lower),
  FOREIGN KEY (player_id) REFERENCES players(id)
);
CREATE INDEX IF NOT EXISTS idx_player_usernames_lower ON player_usernames(name_lower);

CREATE TABLE IF NOT EXISTS rename_requests (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id       TEXT NOT NULL,
  old_melee_name  TEXT NOT NULL,
  new_melee_name  TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',
  melee_hint      TEXT,
  requested_at    TEXT NOT NULL,
  resolved_at     TEXT,
  resolved_by     TEXT,
  note            TEXT,
  FOREIGN KEY (player_id) REFERENCES players(id)
);
CREATE INDEX IF NOT EXISTS idx_rename_requests_player ON rename_requests(player_id);

INSERT OR IGNORE INTO player_usernames (player_id, melee_name, name_lower, source, first_seen, last_seen)
SELECT id, melee_name, LOWER(melee_name), 'seed', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM players WHERE melee_name IS NOT NULL;
