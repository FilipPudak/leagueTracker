# Load reliability

To keep the web app usable during the slow, multi-hop startup (browser → static client
(fetch) → backend script → spreadsheet), the client handles transient failures
gracefully:

- A short spinner is shown while the initial `getAppData` call is in flight.
- The initial `getAppData` call auto-retries **once** — Apps Script web apps intermittently
  fail on cold start.
- If the call still fails, a Retry button appears so the failure never leaves a blank,
  unrecoverable screen.
- Errors are surfaced in the UI with a useful message.

The static page shell is served immediately by `HtmlService`; only the live data (season
selector, dropdowns, leaderboard) is populated once the backend responds. The leaderboard
and My Stats tabs are loaded on first click and cached per season so switching between
seasons within a visit does not re-fetch; re-entering either tab clears its cache so the
data is always fresh on return. A successful vote also clears the leaderboard cache.
Because the leaderboard fetches SWU site standings in real time for the live season (top-3
podium for Galactic Ruler, top-3 climbers for A New Hope), a slow or down site slows that
response; the backend catches the error and sends `null` for the affected section, keeping
the rest of the board up.
