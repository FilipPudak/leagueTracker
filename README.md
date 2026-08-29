# SWU League Voting

A two-part Google Apps Script (GAS) app for running a **Star Wars: Unlimited** league's weekly voting and leaderboards.

## Architecture

This repo contains two separate Apps Script projects:

| Folder     | Role                                                        |
|------------|-------------------------------------------------------------|
| `backend/` | Script 1 — spreadsheet-backed "database engine". Exposes a `doPost` JSON API for linking accounts, submitting weekly votes, and returning leaderboard data. Also handles the weekly lifecycle (advancing weeks, compiling summaries, calculating end-of-season awards) and syncs players from the SWU league website. |
| `frontend/` | Script 2 — the client web app. Proxies requests to Script 1's published URL and serves a mobile-styled UI (`Index.html`) for voting and viewing leaderboards. |
| `appsscript.json` | Apps Script web-app configuration (access, OAuth scopes). |

## Configuration (secrets)

Sensitive values are **not** committed. They are injected at runtime via `process.env`:

- `SPREADSHEET_ID` — Google Sheets ID used as the league database (`backend/Code.gs`)
- `API_URL` — published deployment URL of Script 1 (`frontend/Code.gs`)
- `SCRAPE_URL` — league website scraped for player sync (`backend/Code.gs`, optional)

Copy `.env.example` to `.env` and fill in your real values:

```sh
cp .env.example .env
```

A local `.env` has been created with your real values and is excluded from Git via `.gitignore`.

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
