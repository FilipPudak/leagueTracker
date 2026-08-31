# SWU League Voting

A two-part Google Apps Script (GAS) app for running a **Star Wars: Unlimited** league's
weekly voting and leaderboards.

## What it is

- Players link their Google account once, then submit a weekly vote (a favorite leader
  and favorite opponent) through a mobile-styled web app.
- A spreadsheet-backed backend tracks votes, compiles leaderboards, advances weeks, and
  calculates end-of-season awards.
- Player rosters are synced from the league website (`SCRAPE_URL`) on a recurring trigger.

## Architecture

| Folder     | Role                                                        |
|------------|-------------------------------------------------------------|
| `backend/` | Script 1 — spreadsheet-backed "database engine". Exposes a `doPost` JSON API for linking accounts, submitting weekly votes, and returning leaderboard data. Also handles the weekly lifecycle (advancing weeks, compiling summaries, calculating end-of-season awards) and syncs players from the SWU league website. |
| `frontend/` | Script 2 — the client web app. Proxies requests to Script 1's published URL and serves a mobile-styled UI (`Index.html`) for voting and viewing leaderboards. |

Each project has its own `appsscript.json` manifest:
`backend/appsscript.json` runs as `USER_DEPLOYING` with `ANYONE_ANONYMOUS` access (its
`API_SECRET` gate handles security — see `docs/SECURITY.md`), and `frontend/appsscript.json`
runs as `USER_ACCESSING` with `ANYONE` access (signed-in Google account required).

## Quickstart

1. Create both Apps Script projects and set their **Script Properties** — see
   `docs/DEPLOYMENT.md`.
2. Deploy and republish each project with clasp — see `docs/DEPLOYMENT.md`.
3. Configure your tab structure — see `docs/DATABASE.md`.

## Docs

- [Deployment & configuration](docs/DEPLOYMENT.md) — secrets, Script Properties, clasp deploy/republish.
- [Database (spreadsheet structure)](docs/DATABASE.md) — tabs and columns.
- [Security model](docs/SECURITY.md) — how voting integrity is enforced and its accepted limitation.
- [Load reliability](docs/PERFORMANCE.md) — cold-start retries, spinner, lazy-loaded leaderboard.

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
| 2 — Data & handlers | `test/tier2.handlers.test.js` | Sheet-backed readers and the `doPost` request handlers (`getSettings`, `getAllSeasons`, … `handleLinkGoogleAccount`, `handleSubmitVote`, `handleGetLeaderboardData`, dispatch/security). |
| 3 — Lifecycle & awards | `test/tier3.lifecycle.test.js` | `advanceLeagueWeek`, `compileWeekSummary`, `calculateSeasonAwards`, `startNewSeason`, `syncPlayersFromWebsite`. |

Test harness: `test/mockSheets.js` (GAS mocks + `loadBackend`/`resetSheets` helpers) and
`test/fixtures.js` (the canonical fixture dataset). New tests follow the existing pattern:
call `resetSheets(...)` in `beforeEach` for isolation, then assert against the returned
in-memory sheet objects.
