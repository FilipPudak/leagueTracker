# API Reference

The Worker exposes a single POST endpoint. Every request sends `{ action, ... }`; the
router dispatches to the matching handler. All responses use the envelope:

```json
{ "success": true,  "data": { ... } }
{ "success": false, "error": "message" }
```

Error statuses: `400` (bad request / unknown action), `401` (missing/invalid token),
`403` (admin secret mismatch), `404` (not found), `409` (conflict), `429` (rate limit),
`500` (internal).

## Auth levels

| Level | Mechanism |
|-------|-----------|
| **Public** | No token needed |
| **Token** | `token` field required — resolves to a linked player session |
| **Token (optional)** | `token` field used if present and valid; public if absent |
| **Admin** | `adminToken` field must match the `ADMIN_SECRET` env var (constant-time compare) |

Rate limits (per IP, 60s window): writes capped at 10; reads capped at 90; `requestRename`
has its own bucket capped at 3 so rename submissions cannot spend the vote-write budget
on a shared venue IP.

## Public actions

| Action | Payload | Description |
|--------|---------|-------------|
| `getAwardsData` | `seasonId?` | Award podiums, most-played leaders, participation. Ambassador names are callsign-masked while voting is open; Bounty Hunter renders live (since v4.19.1). |
| `getStandingsData` | `seasonId` (required), `asOfRound?` | Derived season table (best-X nights) + per-night results with phase labels. |
| `getPlayerProfile` | `playerId` (required), `seasonId?` | Full public profile: season stats, career record, badges, leader win-rates. Career record counts regular-season nights only (cut/side events excluded). Omits gamification, rivalry, and finals. |
| `linkAccount` | `email` (required), `deviceId` (required), `playerId?` | Honor-based email claim + session mint. Returns token and link state. |

## Token-optional actions

Session is resolved if a valid token is present; the handler receives `session` (row or `null`).

| Action | Payload | Description |
|--------|---------|-------------|
| `getAppData` | — | Bootstrap bundle: settings, link status, current vote, seasons. If linked: `linkedPlayer`, `alreadyVoted`, `currentVote`, `renameRequest` (`{status, oldMeleeName, newMeleeName, requestedAt, note} \| null`, caller's own latest request only; `note` carries the rejection reason for `rejected` rows and is `null` otherwise). |
| `getVoteBootstrap` | — | Vote-tab bootstrap: participation count, voting state, week. If linked: attended state, current vote, opponent list. |

## Token-required actions

No valid session → `401`.

| Action | Payload | Description |
|--------|---------|-------------|
| `submitVote` | `voteData: { leaderId, opponentId }` | Submits this week's vote. Validates: voting open, not paused, no duplicate, no self-vote, opponent faced that week. Increments raffle ticket. |
| `updateVote` | `voteData: { leaderId, opponentId }` | Replaces both choices for the current week. `404` if no prior vote (use `submitVote`). |
| `unlinkAccount` | — | Deletes the session for this (player, device) pair only. Other devices untouched. |
| `getMySeasonStats` | `seasonId?` | Linked player's private season stats: tickets, streaks, badges, leader win-rates, voting-milestone and 80%-rule progress, awards. |
| `getMyCareerStats` | — | Linked player's private career: regular-season record, rivalry, season progression, badges, and `finals` (`{ nights, matches: { played, wins, draws, losses }, winPct, bestFinish }` over cut/side nights only). |
| `requestRename` | `newMeleeName` (required) | Declares a Melee username change. Validates format, rejects a name held by another email-bearing player. A second submission while one is pending **overwrites** that row (`updated: true`, fresh `requested_at`) so a typo never locks the member out. Stores the `pending` row (+ best-effort `melee_hint`) and notifies the admin webhook ("Rename request updated" on overwrite). Label follows the row until approved. |

## Admin actions

All require `adminToken` matching `ADMIN_SECRET`.

| Action | Payload | Description |
|--------|---------|-------------|
| `startNewSeason` | `seasonId?` | Creates season row if missing; sets `ACTIVE_SEASON_ID`, `CURRENT_WEEK="Week 1"`, `VOTING_OPEN=FALSE`, `SEASON_STARTED=TRUE`. |
| `triggerWeeklyCycle` | — | Manually invokes the sync lifecycle (idempotent). |
| `pauseCurrentSeason` | — | Sets `SEASON_PAUSED=TRUE` — sync continues, no advance/open/close. |
| `resumeCurrentSeason` | — | Sets `SEASON_PAUSED=FALSE`. |
| `getSeasonRewards` | `seasonId` (required) | Read-only finals-night extract for one season. Returns `seasonId`, `seasonName`, `isActiveSeason`, `seasonEnded`, `playerCount`, `totalTickets`, and `players[]` — one row per player who **voted that season**: `playerId`, `name`, `active`, `tickets`, `attended`, `votedInAttended`, `compliancePct`, `qualifies80`, `milestoneComplete`, `bestStreak`. Voters only (the list never grows across seasons); regular-phase attendance only; no opponent data. In the active season the ratio applies the same `CURRENT_WEEK` cutoff as My Stats; `seasonEnded` means the voting window has closed, not that no further Melee data can arrive. |
| `backfillFromMelee` | `seasonId?`, `maxTournaments?`, `resync?`, `allowActiveSeason?` | Historical Melee backfill (bounded batch — see limits below). |

### Backfill semantics

- **Tallies are row/insert counts, not round counts:** `tournaments` = `melee_tournaments`
  INSERTs that changed a row; `standings` / `matches` = rows written this invocation.
- **Budget:** `maxTournaments` (default 5) bounds *rounds with Melee data fetches*,
  shared across seasons in a sweep; tournament INSERTs are never budget-gated.
  Each fetched round costs 2 external fetches (standings + matches), plus one
  list-fetch for the whole invocation.
- **Refusal:** an explicit `seasonId` equal to `ACTIVE_SEASON_ID` while
  `SEASON_STARTED=TRUE` returns
  `{ seasonId, refused: true, reason: 'active-season', tournaments: 0, standings: 0, matches: 0 }`
  unless `allowActiveSeason: true` is passed. A sweep (no `seasonId`) is never refused.
- **Active-season cap:** with `allowActiveSeason: true`, attendance writes for the
  active season are capped at `CURRENT_WEEK` (past seasons are uncapped).
- **Response shape on list-fetch failure:** `{ seasonId, fetchFailed: true,
  tournaments: 0, standings: 0, matches: 0, error }`.
| `materializePastAwards` | `seasonId` (required), `dryRun?` | One-time award materialization for S1–S5 only. |
| `addLeaders` | `leaders: [{ name, set?, aspects? }]` | Inserts leaders with aspect enrichment: explicit `aspects` (whitelist-validated) wins, else one offline lookup against FFG's official card data per distinct set. Returns `{ added, skipped, filled, summary: { requested, added, skipped, filled, unresolved } }`; `added` entries carry `aspects`, `aspectsResolved`, `reason?` and `swuDbSuggestion?` (near-misses are advisory, never auto-applied — replay the row with explicit `aspects`). A name+set duplicate whose stored aspects is NULL is repaired via `filled`. Fully-clean batch ⇔ `summary.unresolved === 0 && summary.skipped === 0 && summary.added === summary.requested`. |
| `setLeadersActive` | `leaderIds: []`, `active: bool` | Activates or deactivates leaders. |
| `removeLeaders` | `leaderIds: []` | Deletes leaders; refuses any referenced by votes. |
| `listRenameRequests` | — | Full rename queue (newest first) with `status`, `melee_hint`, timestamps and `note`. Pending rows also carry `conflictPlayerId` (email-bearing holder that blocks the rename) and `mergeTargets` (`[{playerId, name, rows}]` email-less rows approval would absorb). |
| `approveRename` | `requestId` **or** `playerId` + `newMeleeName`; `confirmMerge?` | Sets `players.melee_name` (identity only — the public `name` belongs to the Melee DisplayName sync), keeps the old handle in `player_usernames`, and merges email-less rows that already hold the new handle (all FKs re-pointed, survivor wins on UNIQUE collisions, self-votes dropped) in one batch. Absorbing rows with stored results requires `confirmMerge: true` (`400` lists the targets otherwise). Idempotent on an already-approved request. |
| `rejectRename` | `requestId`, `note?` | Marks the request `rejected`. Cannot reject an approved request. |
| `mergePlayers` | `survivorId`, `orphanId` | Standalone merge (no rename): re-points standings/matches/votes/attendance/awards, moves username history, drops the orphan row. Refuses rows with two different emails. |

## Session model

- Sessions are per (player, device). Token is a UUID minted at link time.
- 90-day rolling TTL from `last_active` — refreshed on each authenticated request.
- Unlink is device-scoped; other devices of the same player are untouched.

## Platform limits (Cloudflare Workers Free)

| Limit | Free tier | How this codebase stays inside it |
|-------|-----------|-----------------------------------|
| External fetches / invocation | 50 | Typical weekly sync 4–7; leader imports fetch at most once per distinct set (memoized per batch); backfill's `maxTournaments` budget bounds multi-round fetches (2 per round + 1 list fetch) |
| Internal service (D1) calls / invocation | 1,000 | Per-round standings/matches/attendance writes go through `DB.batch()` — one internal call per table per round instead of one per row |
| CPU / cron invocation | 10 ms | I/O wait is free; JSON parsing is the main CPU cost |

A retried Melee request counts as an additional external fetch (retries are not free).
