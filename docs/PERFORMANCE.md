# Load reliability

To keep the web app usable during the slow, multi-hop startup (browser → frontend script
→ URL fetch → backend script → spreadsheet), the frontend handles transient failures
gracefully:

- A short spinner is shown while the initial `getAppData` call is in flight.
- The initial `getAppData` call auto-retries **once** — Apps Script web apps intermittently
  fail on cold start.
- If the call still fails, a Retry button appears so the failure never leaves a blank,
  unrecoverable screen.
- Errors are surfaced in the UI with a useful message.

The static page shell is served immediately by `HtmlService`; only the live data (season
selector, dropdowns, leaderboard) is populated once the backend responds. The leaderboard
tab is lazy-loaded on first click and cached per season so that switching between
seasons does not re-fetch unless the user votes (which clears the cache). Because the
leaderboard now fetches SWU site standings in real time for the live season, a slow or
down site slows that response; the backend catches the error and sends `null` for the
affected section (Galactic Ruler / A New Hope), keeping the rest of the board up.
