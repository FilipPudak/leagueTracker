# SWU League Voting

A **Star Wars: Unlimited** league app for weekly voting and leaderboards, built as a static
front end on GitHub Pages backed by a single Google Apps Script (GAS) "database engine".

## What it is

- Players link once on each device by entering an email and picking their player profile; the
  backend mints a per-device token. They then submit a weekly vote (a favorite leader and
  favorite opponent) through a mobile-styled web app.
- A spreadsheet-backed backend tracks votes, compiles leaderboards, advances weeks, and
  calculates end-of-season awards.
- Player rosters are synced from the league website (`SCRAPE_URL`) on a recurring trigger.

## Architecture

| Folder       | Role                                                        |
|--------------|-------------------------------------------------------------|
| `backend/`   | Apps Script "database engine". Exposes a `doPost` JSON API for linking accounts via per-device session tokens, submitting weekly votes, and returning leaderboard data. Also handles the weekly lifecycle (advancing weeks, compiling summaries, calculating end-of-season awards) and syncs players from the SWU league website. |
| `docs/app/`  | **Static client** (plain HTML/CSS/JS) served from GitHub Pages. Calls the backend `/exec` URL directly with `fetch` — no Google sign-in, no proxy, no shared secret. |

The backend runs as `USER_DEPLOYING` with `ANYONE_ANONYMOUS` access; identity is enforced by
**per-device session tokens**, not a shared secret (see `docs/SECURITY.md`).

## Quickstart

1. Deploy the backend and bake its `/exec` URL into `docs/app/app.js` (`API_URL`) — see
   `docs/DEPLOYMENT.md`.
2. Publish `docs/` on GitHub Pages and point players at the `/app/` sub-path.
3. Configure your tab structure and the `Sessions` sheet — see `docs/DATABASE.md`.

## Docs

- [Deployment & configuration](docs/DEPLOYMENT.md) — Script Properties, clasp deploy, GitHub Pages hosting.
- [Database (spreadsheet structure)](docs/DATABASE.md) — tabs and columns.
- [Security model](docs/SECURITY.md) — how voting integrity is enforced and its accepted limitation.
- [Load reliability](docs/PERFORMANCE.md) — cold-start retries, spinner, lazy-loaded leaderboard.
- [Triggers & lifecycle](docs/TRIGGERS.md) — weekly automation schedule and lifecycle functions.

## Tests

The repo has an offline test suite that runs the apps-script code **without a deployment**.
It uses an in-memory mock of the GAS globals (`SpreadsheetApp`, `PropertiesService`,
`ContentService`, `LockService`, `UrlFetchApp`) layered on top of fixture data, so it needs
no `.env`, no network, and no credentials. Tests are run with Node's built-in runner (`zero
dependencies`):

```sh
npm test          # node --test "test/*.test.js"
```

Runs are organized in three tiers:

| Tier | File | What it covers |
|------|------|----------------|
| 1 — Pure logic | `test/tier1.pure.test.js` | Lock-free helpers: `parseWeek`, `isVotingOpen`, `assignStandardRanks`, `userError`. |
| 2 — Data & handlers | `test/tier2.handlers.test.js` | Sheet-backed readers and the `doPost` request handlers (`getSettings`, `getAllSeasons`, … `linkPlayerToEmail`, `handleSubmitVote`, `handleGetLeaderboardData`, dispatch/security). |
| 3 — Lifecycle & awards | `test/tier3.lifecycle.test.js` | `advanceLeagueWeek`, `calculateSeasonAwards`, `startNewSeason`, `syncPlayersFromWebsite`. |

Test harness: `test/mockSheets.js` (GAS mocks + `loadBackend`/`resetSheets` helpers) and
`test/fixtures.js` (the canonical fixture dataset). New tests follow the existing pattern:
call `resetSheets(...)` in `beforeEach` for isolation, then assert against the returned
in-memory sheet objects.
