# Deployment

This project reads its configuration from **Apps Script Script Properties**, not from
committed files. This page covers the configuration keys, how to set Script Properties,
and how to push and republish each project with clasp.

## Configuration (secrets)

Sensitive values are **not** committed to the repo. They are read at runtime from Apps
Script **Script Properties** (a local `.env` is only used by clasp's local
`process.env` support). The following keys are read by `getConfig()` in
`backend/Code.gs` and `frontend/Code.gs`:

- `SPREADSHEET_ID` — Google Sheets ID used as the league database (`backend/Code.gs`)
- `API_URL` — published deployment URL of Script 1 (`frontend/Code.gs`)
- `SCRAPE_URL` — league website scraped for player sync (`backend/Code.gs`, optional)
- `API_SECRET` — shared secret sent by the frontend proxy and verified by the backend.
  Every `doPost` request must include it; without it, the backend returns `Unauthorized`.
  This prevents anyone who discovers the public backend URL from calling the API directly.
  The secret stays server-side (never sent to the user's browser) and must match in both
  the frontend and backend Script Properties.

A local `.env` mirrors these values for clasp's local tooling and is excluded from Git
via `.gitignore`. See `.env.example` for the template.

## Setting Script Properties

Because a deployed Apps Script web app does **not** have access to `process.env`, set
each key as a **Script Property** in *each* Apps Script project:

1. In the Apps Script editor, open **Project Settings** (gear icon) → **Script Properties**.
2. Add a property per key shown above with the shared `API_SECRET` value.
3. For `frontend`, set `API_URL` to the backend's `/exec` deployment URL.
4. For `backend`, set `SPREADSHEET_ID` (and optionally `SCRAPE_URL`).

These properties live on Google's servers and are never part of the repository.

## Deploying (requires clasp)

Because the scripts read from Script Properties (not committed values), you **must**
deploy with **clasp** (Command Line Apps Script Projects) — the official GAS CLI.

1. Install clasp: `npm install -g @google/clasp`
2. Login: `clasp login`
3. Fill in the Apps Script project IDs in the two `.clasp.json` files (currently placeholders):
   - `backend/.clasp.json`
   - `frontend/.clasp.json`
4. For each script project, from its directory run:
   - `clasp push` — upload local code to Google
   - `clasp deploy` — publish the web app (backend) or update the frontend deployment
5. After deploying the backend, copy the resulting `/exec` URL into `API_URL` as a Script
   Property on the frontend, then `clasp deploy --deploymentId <id>` to republish the
   frontend under the same URL.

> **Important:** `clasp push` alone uploads code but does **not** update what a live
> `/exec` URL serves. To update an in-place deployment, run
> `clasp deploy --deploymentId <id>` against the existing deployment ID.

See <https://github.com/google/clasp> for full docs.
