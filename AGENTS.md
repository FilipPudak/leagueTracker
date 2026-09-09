# AGENTS.md — Persistent Session Instructions

## Project Overview
SWU League Voting app for a Star Wars Unlimited gaming league in Stockholm.
- **Frontend**: Static HTML/JS on GitHub Pages (`docs/app/`)
- **Worker Backend**: Cloudflare Workers + D1 database (`backend/src/`)
- **URL**: https://stockholm.sw-unlimited.com/ (league standings site we scrape)

## Architecture
- **Cloudflare Worker**: `https://league-tracker.filip-pudak.workers.dev`
- **D1 Database ID**: `ccf38d5e-1639-4eb3-8447-9f3644127e4b`
- **Schema**: 12 tables (settings, players, leaders, seasons, sessions, votes, awards, attendance, melee_tournaments, season_standings, match_results) + 9 indexes
- **Season ID format**: "S6" → extracted as integer 6 via `parseInt(str.replace(/\D/g, ''), 10)`
- **Vote CSVs are empty**: Awards were entered manually. The votes table is used for live voting from S7 onwards.

## Commands
```bash
# Run Worker tests (from backend/)
cd backend && node --test "test/**/*.test.js"

# Deploy Worker
cd backend && npx wrangler deploy
```

## Code Conventions
- **Node v24.19.0**, PowerShell environment (use `;` not `&&`)
- **Backend is ESM** (`"type": "module"` in `backend/package.json`)
- **Tests**: `node:test` + `node:assert/strict` only — zero external dependencies
- **No comments in code** unless explicitly requested
- **Keep 6 awards**: Galactic Ruler, Galactic Schemer, Galactic Ambassador, A New Hope, Bounty Hunter, Galactic Champion
- **Gamification**: per-season only, no public individual participation rankings
- **Participation display**: aggregate-only (no individual public rankings)

## D1 Query Patterns
All handlers use `env.DB` (Cloudflare D1 binding):
```js
db.prepare(sql).bind(...params).first()   // → row | undefined
db.prepare(sql).bind(...params).all()     // → { results: [...] }
db.prepare(sql).bind(...params).run()     // → { success: true }
db.prepare(sql).all()                     // no bind
```

## Handler Signature
Every handler: `export async function handleXxx(body, env)` where `env = { DB }`.
Router wraps in `{ success: true, data: result }` or `{ success: false, error: msg }`.

## Admin Actions
- `startNewSeason` — requires `adminToken` in request body matching `env.ADMIN_SECRET`; optional `seasonId` to activate an existing season instead of creating the next one
- Trigger manually via Cloudflare Workers dashboard (Preview tab → POST with JSON body)
- `ADMIN_SECRET` is an encrypted env var in `wrangler.toml`

## Known Patterns / Pitfalls
- `getAllActivePlayers(DB)` returns a D1 result object `{results: [...]}`, NOT an array. Always use `.results` before `.map()`.
- `crypto.randomUUID()` is a Workers global, mocked in tests via `mock-crypto.js`
- `fetch()` is a Workers global, mocked in tests via `mock-fetch.js`
- `CURRENT_WEEK` can be "Season Ended" (not a number) — handle with `parseInt(str.replace(/\D/g, ''), 10)` which returns NaN for non-numeric strings
- Ambassador names are masked with callsigns during live voting (privacy)
- Bounty Hunter is hidden while voting is live
- `LAST_ADVANCED` is a date-based marker (YYYY-MM-DD) — prevents double-advance on dual-cron Wednesdays

## Test Infrastructure
- **Mock DB**: `backend/test/helpers/mock-db.js` — pattern-matching D1 mock (not full SQL)
- **Mock Fetch**: `backend/test/helpers/mock-fetch.js` — URL-to-response mapping
- **Mock Crypto**: `backend/test/helpers/mock-crypto.js` — sequential UUID stubs
- **Fixtures**: `backend/test/helpers/fixtures.js` — `basicTables()`, `emptyTables()`, `closedVotingTables()`
- **391 Worker tests** across: lib, handlers, queries, triggers, router

## Git Conventions
- Commit messages: `type: description` (e.g. `fix:`, `feat:`, `test:`, `chore:`)
- Push to `origin main`
- Frontend changes go in `docs/app/`
- Backend changes go in `backend/src/`

## Versioning

**Semantic Versioning (SemVer):** `MAJOR.MINOR.PATCH`

- **PATCH**: Bug fixes, minor tweaks (fix standings filter, fix subtitle bug)
- **MINOR**: New features, backward compatible (add Standings tab, add Champion award)
- **MAJOR**: Breaking changes, major milestones (schema migration, API redesign)

**Single version** for both frontend and backend (deployed together from same repo).

**Source of truth:** `APP_VERSION` in `docs/app/app.js` (visible to users in footer).

**Backend exposes version** via `getAppData` response (`appVersion` field) for debugging.

**Release flow:**
1. Make changes, commit with conventional messages (`fix:`, `feat:`, `chore:`)
2. Bump `APP_VERSION` in `app.js` when ready to release
3. Deploy backend (`wrangler deploy`)
4. Push frontend (GitHub Pages auto-deploys)
5. Tag release in git (`git tag v4.1.0`)

**Pre-release tags:** Use `-beta.1` or `-rc.1` for testing (e.g., `4.1.0-beta.1`).

**Current version:** 4.0.8

## What NOT to Do
- Don't add external test dependencies (mocha, jest, etc.) — use `node:test` only
- Don't use `&&` in shell commands (PowerShell) — use `;` or separate commands
- Don't commit secrets or API keys
- Don't add individual player participation rankings publicly

## Ask Before Acting — Hard Rules

NEVER do any of the following without explicit user permission in the same message:

1. **`git commit`** — always ask first, even if all changes are ready
2. **`git push`** — always ask first, even after a commit
3. **`wrangler deploy`** — always ask first, even after a push
4. **Amend a commit** — always ask first

"Go ahead", "please do", or similar applies only to the task being discussed (e.g. writing code, fixing a bug). It does NOT count as permission to commit, push, or deploy unless those actions are explicitly mentioned.

When asking, list what you plan to do so the user can approve or adjust:
- "Ready to commit — shall I commit these changes?"
- "Want me to push to origin?"
- "Should I deploy to production?"
