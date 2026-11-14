-- M7: players.melee_guid — Melee AsmoConnectId (account-level verification signal).
-- schema.sql has declared this column since M2, but production never received it and
-- no code read or wrote it until the multi-username finder.
-- Applied via: npx wrangler d1 execute <D1_DATABASE_ID> --remote --file=backend/migrations/M7.sql
-- (the database id is in docs/DEPLOYMENT.md)
-- One-shot: SQLite has no ADD COLUMN IF NOT EXISTS. Re-running fails with
-- "duplicate column name: melee_guid", which is harmless — the column is already there.

ALTER TABLE players ADD COLUMN melee_guid TEXT;
