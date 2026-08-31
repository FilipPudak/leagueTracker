# Performance & caching

To keep the web app snappy, the backend caches slow, slowly-changing reads (the full
season list and the per-season player/leader rosters) in Apps Script `CacheService` for
5 minutes. Settings, the current week, voting state, and all vote submissions are **not**
cached, so correctness-sensitive data is always read fresh.

Player sync runs on a time-driven trigger. Because a freshly added player could be
briefly hidden from cached rosters for up to the 5-minute TTL after a sync, this is a
non-issue in practice — it self-corrects within minutes and only affects dropdown lists,
never identity or voting.

The frontend also shows a short spinner on load, auto-retries the initial `getAppData`
call once (Apps Script web apps intermittently fail on cold start), and offers a Retry
button if the call still fails. Errors are surfaced in the UI so a failure never leaves a
blank screen.
