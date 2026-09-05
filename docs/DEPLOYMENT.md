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
| D1 Database ID | `wrangler.toml` | `ccf38d5e-1639-4eb3-8447-9f3644127e4b` |
| Cron triggers | `wrangler.toml` | `30 8 * * 1` (syncPlayers), `0 9 * * 1` (advanceWeek) |
| `ACTIVE_SEASON_ID` | D1 `settings` table | Current season number |
| `CURRENT_WEEK` | D1 `settings` table | e.g. `Week 3` or `Season Ended` |
| `VOTING_OPEN` | D1 `settings` table | `TRUE` or `FALSE` |
| `SEASON_LENGTH` | D1 `settings` table | Number of weeks per season |

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
npx wrangler d1 execute league-tracker --remote --file=schema.sql
```

The Worker is live at `https://league-tracker.filip-pudak.workers.dev`.

## Deploying the static client (GitHub Pages)

- Set the Pages source to branch `main`, folder `docs`.
- The app lives at the custom domain configured in your GitHub repo settings.
- Any push to `main` that changes `docs/app/*` republishes the client automatically.

## Updating the frontend API URL

The Worker URL is hardcoded in `docs/app/app.js` as the `API_URL` constant. If you
change the Worker name or deploy to a different domain, update this value:

```js
const API_URL = 'https://league-tracker.filip-pudak.workers.dev';
```
