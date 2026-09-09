# Load reliability

The app is a static frontend (GitHub Pages) calling a Cloudflare Worker backend (D1 database).
To keep the experience smooth:

- A short spinner is shown while the initial `getAppData` call is in flight.
- The initial `getAppData` call auto-retries **once** — transient network failures happen.
- If the call still fails, a Retry button appears so the failure never leaves a blank,
  unrecoverable screen.
- Errors are surfaced in the UI with a useful message.

The static page shell is served immediately by GitHub Pages; only the live data (season
selector, dropdowns, leaderboard) is populated once the backend responds. The Standings,
Leaderboard, and My Stats tabs are lazy-loaded on first click and cached per season with a
short (15-second) freshness window, so flicking between tabs doesn't re-fetch while genuine
returns still get fresh data. A successful vote clears the leaderboard cache.
All displayed data is derived from the D1 database (Melee.gg sync); there are no runtime
calls to third-party sites. When a section has no data yet, the backend sends `null` for it
and the UI hides that section, keeping the rest of the board up.
