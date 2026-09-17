-- M3: partial unique index on players.email
-- Applied via: wrangler d1 execute league-tracker --remote --file=backend/migrations/M3.sql

CREATE UNIQUE INDEX IF NOT EXISTS idx_players_email_unique
  ON players(email)
  WHERE email IS NOT NULL AND email != '';
