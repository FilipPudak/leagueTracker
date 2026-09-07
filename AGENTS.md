# AGENTS.md — Persistent Session Instructions

## Project Overview
SWU League Voting app for a Star Wars Unlimited gaming league in Stockholm.
- **Frontend**: Static HTML/JS on GitHub Pages (`docs/app/`)
- **Worker Backend**: Cloudflare Workers + D1 database (`backend/src/`)
- **URL**: https://stockholm.sw-unlimited.com/ (league standings site we scrape)

## Architecture
- **Cloudflare Worker**: `https://league-tracker.filip-pudak.workers.dev`
- **D1 Database ID**: `ccf38d5e-1639-4eb3-8447-9f3644127e4b`
- **Schema**: 9 tables (settings, players, leaders, seasons, sessions, leader_votes, opponent_votes, awards, attendance) + 6 indexes
- **Season ID format**: "S6" → extracted as integer 6 via `parseInt(str.replace(/\D/g, ''), 10)`
- **Vote CSVs are empty**: Awards were entered manually. leader_votes and opponent_votes tables will always be empty.

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
- **Keep 5 awards**: Galactic Ruler, Galactic Schemer, Galactic Ambassador, A New Hope, Bounty Hunter
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
- `startNewSeason` — requires `adminToken` in request body matching `env.ADMIN_SECRET`
- Trigger manually via Cloudflare Workers dashboard (Preview tab → POST with JSON body)
- `ADMIN_SECRET` is an encrypted env var in `wrangler.toml`

## Known Patterns / Pitfalls
- `getAllActivePlayers(DB)` returns a D1 result object `{results: [...]}`, NOT an array. Always use `.results` before `.map()`.
- `crypto.randomUUID()` is a Workers global, mocked in tests via `mock-crypto.js`
- `fetch()` is a Workers global, mocked in tests via `mock-fetch.js`
- `CURRENT_WEEK` can be "Season Ended" (not a number) — handle with `parseInt(str.replace(/\D/g, ''), 10)` which returns NaN for non-numeric strings
- Ambassador names are masked with callsigns during live voting (privacy)
- Bounty Hunter is hidden while voting is live

## Test Infrastructure
- **Mock DB**: `backend/test/helpers/mock-db.js` — pattern-matching D1 mock (not full SQL)
- **Mock Fetch**: `backend/test/helpers/mock-fetch.js` — URL-to-response mapping
- **Mock Crypto**: `backend/test/helpers/mock-crypto.js` — sequential UUID stubs
- **Fixtures**: `backend/test/helpers/fixtures.js` — `basicTables()`, `emptyTables()`, `closedVotingTables()`
- **244 Worker tests** across: lib, handlers, queries, triggers, router

## Git Conventions
- Commit messages: `type: description` (e.g. `fix:`, `feat:`, `test:`, `chore:`)
- Push to `origin main`
- Frontend changes go in `docs/app/`
- Backend changes go in `backend/src/`

## What NOT to Do
- Don't add external test dependencies (mocha, jest, etc.) — use `node:test` only
- Don't use `&&` in shell commands (PowerShell) — use `;` or separate commands
- Don't commit secrets or API keys
- Don't add individual player participation rankings publicly

## Ask Before Acting
- **Always ask before `git push`** — confirm the user wants to push
- **Always ask before `wrangler deploy`** — confirm the user wants to deploy to production
- **Ask about commit strategy** — when unsure if changes should be 1 commit or several, ask
- **Ask about amending** — when you think an amend might be appropriate, ask first
