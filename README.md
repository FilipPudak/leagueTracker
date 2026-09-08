# SWU League Voting

A **Star Wars: Unlimited** league app for weekly voting and leaderboards, built as a static
front end on GitHub Pages backed by a Cloudflare Worker + D1 database backend.

## What it is

- Players link once on each device by entering an email and picking their player profile; the
  backend mints a per-device token. They then submit a weekly vote (a favorite leader and
  favorite opponent) through a mobile-styled web app.
- A Cloudflare Worker backend tracks votes, compiles leaderboards, advances weeks, and
  calculates end-of-season awards. Data is stored in a D1 (SQLite) database.
- Player data is synced from the Melee.gg API on a weekly cron trigger (dual-cron for DST handling).
- Gamification features: raffle tickets (1 per vote), compliance tracking, streak tracking, and voting milestones.
- 4 tabs: Vote | Standings | Awards | My Stats

## Architecture

| Folder | Role |
|--------|------|
| `backend/src/` | **Cloudflare Worker** backend. Modular ES modules handling API requests, weekly lifecycle triggers, and SWU site scraping. Data stored in D1. |
| `docs/app/` | **Static client** (plain HTML/CSS/JS) served from GitHub Pages. Calls the Worker URL directly with `fetch`. |

The backend is protected by **per-device session tokens** (see `docs/SECURITY.md`).

## Quickstart

1. Deploy the Worker and verify the `API_URL` in `docs/app/app.js` points to it — see
   `docs/DEPLOYMENT.md`.
2. Publish `docs/` on GitHub Pages and point players at the `/app/` sub-path.
3. Configure the D1 `settings` table — see `docs/DATABASE.md`.

## Docs

- [Deployment & configuration](docs/DEPLOYMENT.md) — Worker deploy, GitHub Pages, D1 config.
- [Database (D1 schema)](docs/DATABASE.md) — tables, columns, and award computation.
- [Security model](docs/SECURITY.md) — how voting integrity is enforced.
- [Load reliability](docs/PERFORMANCE.md) — retry logic, lazy-loaded leaderboard.
- [Triggers & lifecycle](docs/TRIGGERS.md) — weekly automation schedule and lifecycle functions.

## Tests

The Cloudflare Worker backend has a comprehensive test suite using `node:test` and an
in-memory D1 mock — zero external dependencies:

```sh
cd backend && node --test "test/**/*.test.js"
```

| Category | Files | Tests |
|----------|-------|-------|
| Library (awards, auth, meleeLeague, participation, seasonTable) | 6 files | 120+ |
| Handlers (getAppData, submitVote, linkAccount, getStandingsData, etc.) | 13 files | 150+ |
| Database queries | 1 file | 17 |
| Triggers (syncFromMelee, backfillFromMelee) | 2 files | 35+ |
| Router (CORS, routing, error handling) | 1 file | 30+ |
| Schema tests | 1 file | 10+ |
| **Total** | **24 files** | **391** |

Test infrastructure: `backend/test/helpers/mock-db.js` (D1 mock), `mock-fetch.js`,
`mock-crypto.js`, `fixtures.js`, `test-utils.js`.
