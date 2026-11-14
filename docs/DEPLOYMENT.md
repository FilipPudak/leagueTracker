# Deployment

The app has two independently deployed parts:

1. **Static client** — plain HTML/CSS/JS at `docs/app/`, served from GitHub Pages
   (`main/docs`, sub-path `/app/`). No build step, no backend runtime.
2. **Backend** — a Cloudflare Worker (`backend/src/`) backed by a D1 database. The static
   client calls it directly with `fetch`.

There is **no** shared secret. Client identity is a per-device session token minted by the
backend at link time (see `docs/SECURITY.md`).

## Backend configuration

All configuration lives in `backend/wrangler.toml` and the D1 `settings` table:

| Setting | Location | Description |
|---------|----------|-------------|
| D1 Database ID | `wrangler.toml` | See `backend/wrangler.toml` |
| Cron triggers | `wrangler.toml` | `15 20,21,22 * * WED`, `0 7 * * THU`, `15 */2 * * *` (UTC) — three Wednesday fires + Thursday retry + 2h liveness probe |
| `ACTIVE_SEASON_ID` | D1 `settings` table | Current season number |
| `CURRENT_WEEK` | D1 `settings` table | e.g. `Week 3` or `Season Ended` |
| `VOTING_OPEN` | D1 `settings` table | `TRUE` or `FALSE` |
| `SEASON_STARTED` | D1 `settings` table | Gates whether the weekly sync runs |
| `SEASON_PAUSED` | D1 `settings` table | Sync keeps running but week advance/open/close is skipped |
| `LAST_ADVANCED` | D1 `settings` table | Date marker (`YYYY-MM-DD`) preventing double-advance on dual-cron Wednesdays |
| `LAST_CRON_AT` | D1 `settings` table | ISO timestamp of last real cron fire |
| `LAST_PROBE_AT` | D1 `settings` table | ISO timestamp of last liveness-probe fire |

## Deploying the backend (Cloudflare Workers)

Prerequisites: Node.js, Cloudflare account with D1 access.

```sh
# From backend/
cd backend

# Install dependencies
npm install

# Deploy to production
npx wrangler deploy

# Run locally during development
npx wrangler dev

# Apply schema changes (if schema.sql changed)
npx wrangler d1 execute ccf38d5e-1639-4eb3-8447-9f3644127e4b --remote --file=schema.sql

# Incremental migrations (see backend/migrations/), in order. The database name
# `league-tracker` is rejected for D1 calls — use the UUID.
npx wrangler d1 execute ccf38d5e-1639-4eb3-8447-9f3644127e4b --remote --file=backend/migrations/M6.sql
npx wrangler d1 execute ccf38d5e-1639-4eb3-8447-9f3644127e4b --remote --file=backend/migrations/M7.sql
```

M6 is re-runnable (`IF NOT EXISTS` / `OR IGNORE`). **M7 is one-shot** — it does
`ALTER TABLE players ADD COLUMN melee_guid TEXT`, and SQLite has no
`ADD COLUMN IF NOT EXISTS`, so a second run fails harmlessly with
"duplicate column name". Both must be applied **before** deploying code that
references `melee_guid` or `player_usernames`; otherwise every sync fails with
`no such column`.

Post-migration check (expect `history` = number of players with a handle, `no_guid` = all of them until the first sync):

```bash
npx wrangler d1 execute ccf38d5e-1639-4eb3-8447-9f3644127e4b --remote --command \
  "SELECT (SELECT COUNT(*) FROM player_usernames) AS history, (SELECT COUNT(*) FROM players WHERE melee_guid IS NULL) AS no_guid"
```

Optional rename-notification webhook (rename requests post to it):

```bash
npx wrangler secret put DISCORD_WEBHOOK_URL
```

## Deploying the static client (GitHub Pages)

- Set the Pages source to branch `main`, folder `docs`.
- The app lives at the custom domain configured in your GitHub repo settings.
- Any push to `main` that changes `docs/app/*` republishes the client automatically.

## Updating the frontend API URL

The Worker URL is in `docs/app/app.js` as the `API_URL` constant. It auto-detects
`localhost` and points to the local dev server — no flag needed for local development.
For production, it uses the deployed Worker URL (see `backend/wrangler.toml` or the
Cloudflare dashboard for your Worker's URL).

## Backfill operations note

`backfillFromMelee` refuses to run against the active season while `SEASON_STARTED=TRUE`
unless the payload includes `allowActiveSeason: true` — backfilling a live season can
create permanent attendance holes (capped at `CURRENT_WEEK` when the flag is used).
A sweep (no `seasonId`) is never refused.
