# Contributing

A **Star Wars: Unlimited** league app: static frontend on GitHub Pages, Cloudflare
Worker + D1 backend. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for system
overview and [`CONTEXT.md`](CONTEXT.md) for domain language.

## Commands

```sh
# Lint (from repo root)
npm run lint
npm run lint:fix
npm run lint:js   # eslint only (also :css / :html)

# Tests (from backend/)
cd backend && node --test "test/**/*.test.js"

# Deploy Worker
cd backend && npx wrangler deploy
```

## Linting

ESLint 10 flat config at repo root (`eslint.config.mjs`), plus stylelint and
html-validate. Errors block pushes; warnings are advisory.

## Code conventions

- **Node v24**, PowerShell environment (use `;` not `&&`)
- **Backend is ESM** (`"type": "module"`)
- **Tests**: `node:test` + `node:assert/strict` only — zero external dependencies
- **No comments** in code unless explicitly requested
- **6 awards** kept: Galactic Ruler, Galactic Schemer, Galactic Ambassador, A New Hope,
  Bounty Hunter, Galactic Champion
- **Gamification**: per-season only, no public individual participation rankings
- **Participation display**: aggregate-only

## D1 query patterns

```js
db.prepare(sql).bind(...params).first()   // → row | undefined
db.prepare(sql).bind(...params).all()     // → { results: [...] }
db.prepare(sql).bind(...params).run()     // → { success: true }
db.prepare(sql).all()                     // no bind
```

## Handler signature

Every handler: `export async function handleXxx(body, env, session?)`.

- `env = { DB, ... }`
- `session` is present only for token-gated actions
- Router wraps the result in `{ success: true, data }` or `{ success: false, error }`

## Test infrastructure

- `backend/test/helpers/mock-db.js` — pattern-matching D1 mock
- `backend/test/helpers/mock-fetch.js` — URL-to-response mapping
- `backend/test/helpers/mock-crypto.js` — sequential UUID stubs
- `backend/test/helpers/fixtures.js` — `basicTables()`, `emptyTables()`, `closedVotingTables()`

## Git conventions

- Commit messages: `type: description` (e.g. `fix:`, `feat:`, `test:`, `chore:`)
- Push to `origin main`
- Frontend changes go in `docs/app/`
- Backend changes go in `backend/src/`

## Versioning

Semantic Versioning: `MAJOR.MINOR.PATCH`

- **PATCH**: bug fixes, minor tweaks
- **MINOR**: new features, backward compatible
- **MAJOR**: breaking changes, schema migration, API redesign

Source of truth: `APP_VERSION` in `docs/app/app.js`. Bump it AND update the matching
`?v=` cache-bust stamps on `styles.css` / `app-core.js` / `app.js` links in
`index.html` (a test enforces they match).

**Release flow:**
1. Commit with conventional messages
2. Bump `APP_VERSION` + `?v=` stamps
3. Tag: `git tag v<VERSION>`
4. Deploy backend (`npx wrangler deploy`)
5. Push frontend (GitHub Pages auto-deploys)
6. Push tags: `git push origin main --tags`

## What NOT to do

- Don't add external test dependencies (mocha, jest, etc.)
- Don't use `&&` in shell commands (PowerShell)
- Don't commit secrets, API keys, or player PII
- Don't commit DB dumps or session tokens
- Don't add individual player participation rankings publicly
