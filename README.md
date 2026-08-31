# SWU League Voting

A two-part Google Apps Script (GAS) app for running a **Star Wars: Unlimited** league's weekly voting and leaderboards.

## Architecture

This repo contains two separate Apps Script projects:

| Folder     | Role                                                        |
|------------|-------------------------------------------------------------|
| `backend/` | Script 1 — spreadsheet-backed "database engine". Exposes a `doPost` JSON API for linking accounts, submitting weekly votes, and returning leaderboard data. Also handles the weekly lifecycle (advancing weeks, compiling summaries, calculating end-of-season awards) and syncs players from the SWU league website. |
| `frontend/` | Script 2 — the client web app. Proxies requests to Script 1's published URL and serves a mobile-styled UI (`Index.html`) for voting and viewing leaderboards. |

Each project has its own `appsscript.json` manifest:

- `backend/appsscript.json` — `executeAs: USER_DEPLOYING`, `access: ANYONE_ANONYMOUS` ("Anyone"). It is called **server-to-server** from the frontend's `UrlFetchApp`, which carries no Google user token. If it required a signed-in Google account, Google would return HTTP 401 on every call. It is instead protected by the `API_SECRET` check in `doPost`.
- `frontend/appsscript.json` — `executeAs: USER_ACCESSING`, `access: ANYONE` (requires a signed-in Google account to use, so anonymous callers are blocked at the boundary). In Apps Script, `ANYONE` means "anyone with a Google account".

## Performance & caching

To keep the web app snappy, the backend caches slow, slowly-changing reads (the full
season list and the per-season player/leader rosters) in Apps Script `CacheService`
for 5 minutes. Settings, the current week, voting state, and all vote submissions are
**not** cached, so correctness-sensitive data is always read fresh.

The frontend also shows a short spinner on load, auto-retries the initial
`getAppData` call once (Apps Script web apps intermittently fail on cold start), and
offers a Retry button if the call still fails. Errors are surfaced in the UI so a
failure never leaves a blank screen.

## Configuration (secrets)

Sensitive values are **not** committed to the repo. They are read at runtime from **Apps Script Script Properties** (`.env` is only used by clasp's local `process.env` support). The following keys are read by `getConfig()` in `backend/Code.gs` and `frontend/Code.gs`:

- `SPREADSHEET_ID` — Google Sheets ID used as the league database (`backend/Code.gs`)
- `API_URL` — published deployment URL of Script 1 (`frontend/Code.gs`)
- `SCRAPE_URL` — league website scraped for player sync (`backend/Code.gs`, optional)
- `API_SECRET` — shared secret sent by the frontend proxy and verified by the backend. Every `doPost` request must include it; without it, the backend returns `Unauthorized`. This prevents anyone who discovers the public backend URL from calling the API directly. The secret stays server-side (never sent to the user's browser) and must match in both the frontend and backend Script Properties.

A local `.env` mirrors these values for clasp's local tooling and is excluded from Git via `.gitignore`. See `.env.example` for the template.

## Setting Script Properties

Because a deployed Apps Script web app does **not** have access to `process.env`, set each key as a **Script Property** in *each* Apps Script project:

1. In the Apps Script editor, open **Project Settings** (gear icon) → **Script Properties**.
2. Add a property per key shown above with the shared `API_SECRET` value.
3. For `frontend`, set `API_URL` to the backend's `/exec` deployment URL.
4. For `backend`, set `SPREADSHEET_ID` (and optionally `SCRAPE_URL`).

These properties live on Google's servers and are never part of the repository.

## Deploying (requires clasp)

Because the scripts read from Script Properties (not committed values), you **must** deploy with **clasp** (Command Line Apps Script Projects) — the official GAS CLI.

1. Install clasp: `npm install -g @google/clasp`
2. Login: `clasp login`
3. Fill in the Apps Script project IDs in the two `.clasp.json` files (currently placeholders):
   - `backend/.clasp.json`
   - `frontend/.clasp.json`
4. For each script project, from its directory run:
   - `clasp push` — upload local code to Google
   - `clasp deploy` — publish the web app (backend) or update the frontend deployment
5. After deploying the backend, copy the resulting `/exec` URL into `API_URL` as a Script Property on the frontend, then `clasp deploy --deploymentId <id>` to republish the frontend under the same URL.

See <https://github.com/google/clasp> for full docs.

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

## Security model

- **API_SECRET** — the backend is deployed as `ANYONE_ANONYMOUS` because it is called server-to-server from the frontend and therefore cannot require signed-in users (that would 401). The `API_SECRET` check in `doPost` is what actually rejects unknown callers, making anonymous accessibility safe.
- **Google identity for voting** — votes and account links are bound to the player whose Google email (`Session.getActiveUser().getEmail()`) is linked. A user can only act as their own linked player; anonymous callers are blocked both by the frontend guard and by the `ANYONE` access level (signed-in Google account required).
- **Admin lifecycle** — week advancement (`advanceLeagueWeek`) is not exposed via the public API; it runs only via a time-driven trigger or manual invocation.

### Accepted limitation: client-asserted email

The backend runs as `ANYONE_ANONYMOUS` because it is called **server-to-server** from the frontend's `UrlFetchApp`, which carries no Google user token. As a result, the backend cannot independently re-verify the email against Google on each request — it trusts the `userEmail` asserted by the frontend proxy, and the frontend obtains that email from the signed-in Google user (`Session.getActiveUser().getEmail()`).

In practice, exploiting this requires knowing the `API_SECRET` (which is server-side only, never sent to the browser, and never committed), so it is accepted for casual-league use. Mitigations already in place:

- Mandatory one-time account link step before any vote is accepted.
- One vote per email per week, enforced under a script lock (`hasSubmittedThisWeek` + `LockService`).
- Full audit logging on every `getAppData`, `linkGoogleAccount`, and `submitVote` call (View → Executions) so anomalies can be detected and corrected manually.

**Deferred upgrade:** if competitive integrity or public security review ever matters, replace the client-asserted email with a verified token: the frontend sends `ScriptApp.getOAuthToken()` and the backend resolves it against `https://www.googleapis.com/oauth2/v3/userinfo`, ignoring the asserted email. See the local `docs/phase2-token-verification.md` note.

