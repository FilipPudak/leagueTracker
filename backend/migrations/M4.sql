-- M4: add rank column to awards for Ruler podium ranking
-- Applied via: wrangler d1 execute league-tracker --remote --file=backend/migrations/M4.sql

ALTER TABLE awards ADD COLUMN rank INTEGER;
