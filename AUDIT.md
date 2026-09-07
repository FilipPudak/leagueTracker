# Full Codebase Audit Report

**Date:** 2026-09-07
**Scope:** Backend (Cloudflare Workers + D1), Frontend (HTML/JS), Tests, Security

---

## Critical (1)

| # | Issue | Location | Source | Status |
|---|-------|----------|--------|--------|
| **C1** | **Duplicate player IDs on multi-player sync** — `maxId` recomputed from stale snapshot inside loop; all new players get the same ID, crashing on UNIQUE constraint | `syncPlayers.js:54-60` | Production Readiness | DONE |

## High (8)

| # | Issue | Location | Source | Status |
|---|-------|----------|--------|--------|
| **H1** | **Any user can overwrite any player's email** — selecting a name from the dropdown lets you hijack the account | `linkAccount.js:38-41` | Security | DONE |
| **H2** | **No rate limiting on any endpoint** — spam votes, link attempts, enumeration | `index.js` | Security | DONE |
| **H3** | **Admin token uses non-constant-time comparison** — timing side-channel | `startNewSeason.js:7` | Security | DONE |
| **H4** | **CORS allows all origins** — any site can submit authenticated requests | `index.js:17` | Production Readiness | DONE |
| **H5** | **`linkAccount` race condition** — concurrent requests create duplicate sessions | `linkAccount.js:44-55` | Production Readiness | DONE |
| **H6** | **`tieAwareTop3` silently truncated** — 4+ tied players cut to 3, defeating tie logic | `awards.js:27-33,72` | Production Readiness | DONE |
| **H7** | **Cron trigger errors swallowed** — no try/catch, no retry, no concurrency guard | `index.js:98-115` | Production Readiness | DONE |
| **H8** | **Router missing `linkAccount`/`getLeaderboardData`/`startNewSeason` action tests** | `router.test.js` | Test Coverage | DONE |

## Medium (17)

| # | Issue | Location | Source | Status |
|---|-------|----------|--------|--------|
| M1 | No CSP, X-Frame-Options, or security headers | `index.html`, `index.js` | Security | |
| M2 | `getAppData` returns full settings table (info leakage) | `getAppData.js:59-65` | Security | DONE |
| M3 | Session token in `localStorage` (XSS amplification) | `app.js:11,61` | Security | SKIP |
| M4 | Missing composite index `attendance(season_id, player_id)` | `schema.sql` | Production Readiness | DONE |
| M5 | `adminToken` in POST body (logged by Workers) | `startNewSeason.js:7` | Production Readiness | SKIP |
| M6 | `handleLinkAccount` returns `seasonId: 0` when no active season | `linkAccount.js:95` | Production Readiness | DONE |
| M7 | `collapseDeviceSessions` does N individual deletes | `auth.js:86-97` | Production Readiness | SKIP |
| M8 | `getLeaderboardData` makes 20+ sequential DB calls | `getLeaderboardData.js` | Production Readiness | SKIP |
| M9 | `confirmUnlink` has no reentrancy guard | `app.js:365-391` | Frontend | DONE |
| M10 | HTML attribute injection via `escapeHtml` in class names | `app.js:693-696` | Frontend | DONE |
| M11 | Broken recovery after unlink + failed refetch | `app.js:375-391` | Frontend | DONE |
| M12 | `mock-db.js` IN clause silently skipped | `mock-db.js:205-206` | Tests | SKIP |
| M13 | `cleanupTestEnv` calls nonexistent `uninstallCryptoCounter` | `test-utils.js:31` | Tests | SKIP |
| M14 | Mock DB doesn't enforce foreign keys | mock-db.js | Tests | SKIP |
| M15 | `mock-db.js` batch() runs sequentially (not transactional) | `mock-db.js:66-71` | Tests | SKIP |
| M16 | No test for `scheduled()` cron dispatch | `index.js:98-115` | Tests | SKIP |
| M17 | Scraping-dependent awards have no DB fallback | `syncPlayers.js:103`, `advanceWeek.js:42` | Root Cause | SKIP |

## Low (19)

| # | Issue | Location | Status |
|---|-------|----------|--------|
| L1 | Unused `existingEmailMap` in syncPlayers | `syncPlayers.js:38` | DONE |
| L2 | `findPlayerByMelee` duplicated in 2 files | `advanceWeek.js:6-11`, `syncPlayers.js:7-12` | DONE |
| L3 | Week parsing duplicated across 6+ files | multiple | DONE |
| L4 | "Already voted" check duplicated | `getAppData.js:31-34`, `submitVote.js:53-55` | DONE |
| L5 | Award computation duplicated in both triggers | `advanceWeek.js:34-81`, `syncPlayers.js:92-140` | SKIP |
| L6 | Repeated error-throw boilerplate in all handlers | all handlers | SKIP |
| L7 | Inconsistent settings access (individual vs bulk) | `linkAccount.js`, `submitVote.js` | DONE |
| L8 | Unused destructured `token` | `getAppData.js:7` | DONE |
| L9 | Missing `deviceId` validation | `linkAccount.js:7` | DONE |
| L10 | No input length validation on email | `linkAccount.js:15` | DONE |
| L11 | 90-day session TTL is long | `auth.js:1` | SKIP |
| L12 | No keyboard nav semantics for tabs | `index.html:253-256` | SKIP |
| L13 | No `aria-live` region for status messages | `index.html:258` | SKIP |
| L14 | Inline onclick handlers throughout | `index.html` | SKIP |
| L15 | `APP_VERSION` manually bumped | `app.js:18` | SKIP |
| L16 | Scraping regex is fragile | `scraping.js:43` | SKIP |
| L17 | `touchSessionTimestamp` failure causes 500 | `auth.js` | DONE |
| L18 | NaN propagation from "Season Ended" CURRENT_WEEK | multiple files | SKIP |
| L19 | `formatScore` mutates score type (number to string) | `getLeaderboardData.js:188-194` | SKIP |

---

## Recommended Fix Priority

### Immediate (before next deploy)
1. Fix `maxId` loop bug in `syncPlayers.js` — **CRITICAL**
2. Protect email ownership in `linkAccount.js` — **HIGH** (security)
3. Add rate limiting — **HIGH** (security)
4. Tighten CORS to app domain — **HIGH**
5. Add `unlinkInFlight` reentrancy guard — **MEDIUM** (frontend)

### Short-term (this sprint)
6. Add `deviceId` validation
7. Add composite index on `attendance(season_id, player_id)`
8. Add security headers (CSP, X-Frame-Options)
9. Extract duplicated code (findPlayerByMelee, parseWeek, hasPlayerVotedThisWeek)
10. Fix test isolation (crypto mock cleanup, global fetch restore)

### Medium-term
11. Move `adminToken` to request header
12. Batch DB reads in `getLeaderboardData`
13. Add missing test scenarios (router integration, "Season Ended" paths, cron dispatch)
14. Add manual `materializeAwards` admin action for scraping failures

---

## Positive Findings

| Area | Status |
|------|--------|
| SQL Injection | All queries use parameterized `.bind()` — zero string interpolation in SQL |
| Session Tokens | UUID v4 via `crypto.randomUUID()` — high entropy |
| XSS (main paths) | `escapeHtml()` used consistently; `textContent` preferred for status messages |
| Duplicate Vote Prevention | UNIQUE constraint + pre-check + batch with constraint catch |
| Self-Vote Prevention | Explicit check in `submitVote` |
| Session Cleanup | Expired/invalid sessions auto-deleted on use |
| Dependencies | Zero runtime dependencies; only `wrangler` as devDependency |
| Secret Management | `ADMIN_SECRET` not in repo; `.env` properly gitignored |
| Admin Auth | `startNewSeason` requires admin token; not in public action list |
