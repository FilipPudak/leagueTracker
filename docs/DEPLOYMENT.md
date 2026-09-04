# Deployment

The app has two independently deployed parts:

1. **Static client** — plain HTML/CSS/JS at `docs/app/`, served from GitHub Pages
   (`main/docs`, sub-path `/app/`). No build step, no backend runtime.
2. **Backend** — a single Apps Script project (`backend/`) deployed as a web app at
   `/exec`. The static client calls it directly with `fetch`.

There is **no** `API_SECRET` and **no** shared secret (removed at Stage 2 cut-over). Client
identity is a per-device session token minted by the backend at link time; the backend runs as
`ANYONE_ANONYMOUS` and is protected by that token model (see `SECURITY.md`).

## Backend configuration (Script Properties)

Read at runtime from Apps Script **Script Properties** in the `backend/` project (set in the
Apps Script editor → Project Settings → Script Properties). Not committed to the repo; a local
`.env` mirrors them for clasp tooling and is git-ignored.

- `SPREADSHEET_ID` — the Google Sheets league database.
- `SCRAPE_URL` — league website scraped for player sync (optional).

## Deploying the backend (requires clasp)

1. Install clasp: `npm install -g @google/clasp`
2. Login: `clasp login`
3. Fill in the backend project ID in `backend/.clasp.json`.
4. From `backend/`:
   - `clasp push` — upload `Code.gs` + `appsscript.json`.
   - `clasp deploy --deploymentId <id>` — publish under the **same** `/exec` URL (pin it with
     the deployment ID instead of creating a new URL each time).
5. Bake the resulting `/exec` URL into `docs/app/app.js` as the `API_URL` constant, then
   commit + push so GitHub Pages serves it.

> **Important:** `clasp push` alone uploads code but does **not** update what a live `/exec`
> URL serves. To update an in-place deployment, run
> `clasp deploy --deploymentId <id>` against the existing deployment ID.

## Deploying the static client (GitHub Pages)

- Set the Pages source to branch `main`, folder `docs`.
- The app lives at `https://FilipPudak.github.io/leagueTracker/app/`.
- Any push to `main` that changes `docs/app/*` republishes the client automatically.

See <https://github.com/google/clasp> for full clasp docs.
