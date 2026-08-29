# SWU League Voting

A two-part Google Apps Script (GAS) app for running a **Star Wars: Unlimited** league's weekly voting and leaderboards.

## Architecture

This repo contains two separate Apps Script projects:

| Folder     | Role                                                        |
|------------|-------------------------------------------------------------|
| `backend/` | Script 1 — spreadsheet-backed "database engine". Exposes a `doPost` JSON API for linking accounts, submitting weekly votes, and returning leaderboard data. Also handles the weekly lifecycle (advancing weeks, compiling summaries, calculating end-of-season awards) and syncs players from the SWU league website. |
| `frontend/` | Script 2 — the client web app. Proxies requests to Script 1's published URL and serves a mobile-styled UI (`Index.html`) for voting and viewing leaderboards. |

Each project has its own `appsscript.json` manifest:

- `backend/appsscript.json` — `executeAs: USER_DEPLOYING`, `access: ANYONE` (called server-to-server only, guarded by the `API_SECRET`).
- `frontend/appsscript.json` — `executeAs: USER_ACCESSING`, `access: ANYONE_WITH_GOOGLE` (forces a Google sign-in before the UI loads, so anonymous callers are blocked at the boundary).

## Configuration (secrets)

Sensitive values are **not** committed. They are injected at runtime via `process.env`:

- `SPREADSHEET_ID` — Google Sheets ID used as the league database (`backend/Code.gs`)
- `API_URL` — published deployment URL of Script 1 (`frontend/Code.gs`)
- `SCRAPE_URL` — league website scraped for player sync (`backend/Code.gs`, optional)
- `API_SECRET` — shared secret sent by the frontend proxy and verified by the backend. Every `doPost` request must include it; without it, the backend returns `Unauthorized`. This prevents anyone who discovers the public backend URL from calling the API directly. The secret stays server-side (never sent to the user's browser) and must match in both the frontend and backend `.env` files.

Copy `.env.example` to `.env` and fill in your real values:

```sh
cp .env.example .env
```

A local `.env` has been created with your real values and is excluded from Git via `.gitignore`.

## Spreadsheet structure

The backend persists everything to a single Google Sheets document (`SPREADSHEET_ID`). It expects the following tabs. Each row is a record; the first row is assumed to be a header and is skipped.

| Sheet | Columns |
|-------|---------|
| `Settings` | `A` key · `B` value. Keys: `ACTIVE_SEASON_ID`, `CURRENT_WEEK` (e.g. `Week 3`), `VOTING_OPEN` (`TRUE`/`FALSE`) |
| `Players` | `A` id (e.g. `P001`) · `B` name · `C` melee name · `D` Google email (linking) · `E` active (`TRUE`/`FALSE`) |
| `Leaders` | `A` id · `B` leader name · `C` subtitle. Display name shown as `B - C` |
| `Seasons` | `A` id (number) · `B` name (e.g. `Season 4`) · `C` created date |
| `SeasonPlayers` | `A` seasonId · `B` playerId · `C` active (`TRUE`/`FALSE`) |
| `SeasonLeaders` | `A` seasonId · `B` leaderId · `C` active (`TRUE`/`FALSE`) |
| `LeaderVotes` | `A` timestamp · `B` seasonId · `C` week · `D` voter playerId · `E` leaderId · `F` constant `1` |
| `OpponentVotes` | `A` timestamp · `B` seasonId · `C` week · `D` opponent playerId · `E` voter playerId |
| `SubmissionLog` | `A` timestamp · `B` seasonId · `C` week · `D` playerId (used to enforce one submission per week) |
| `SeasonSummary` | `A` timestamp · `B` seasonId · `C` week · `D` top leaderId · `E` leader vote count · `F` top opponentId · `G` opponent vote count |
| `Awards` | `A` seasonId · `B` category (e.g. `Favorite Opponent`) · `C` playerId · `D` player name · `E` votes · `F` timestamp |

`SeasonPlayers` and `SeasonLeaders` control which players/leaders are active for a given season; if a season row is absent, all master players/leaders are used.

## Deploying (requires clasp)

Because the scripts read from `process.env`, you **must** deploy with **clasp** (Command Line Apps Script Projects) — the official GAS CLI — so the environment variables resolve. You cannot simply paste the committed code into the browser editor.

1. Install clasp: `npm install -g @google/clasp`
2. Login: `clasp login`
3. Fill in the Apps Script project IDs in the two `.clasp.json` files (currently placeholders):
   - `backend/.clasp.json`
   - `frontend/.clasp.json`
4. For each script project, from its directory run:
   - `clasp push` — upload local code to Google
   - `clasp deploy` (backend) — publish the web app; copy the resulting `/exec` URL into `API_URL` in your `.env`

See <https://github.com/google/clasp> for full docs.

## Security model

- **API_SECRET** — the backend rejects any `doPost` that lacks the shared secret, blocking unknown callers who discover the public backend URL.
- **Google identity for voting** — votes and account links are bound to the player whose Google email (`Session.getActiveUser().getEmail()`) is linked. A user can only act as their own linked player; anonymous callers are blocked both by the frontend guard and by the `ANYONE_WITH_GOOGLE` access level.
- **Admin lifecycle** — week advancement (`advanceLeagueWeek`) is not exposed via the public API; it runs only via a time-driven trigger or manual invocation.

