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

Rate limits (per IP, 60s window): writes capped at 10; reads capped at 90.

## Public actions

| Action | Payload | Description |
|--------|---------|-------------|
| `getAwardsData` | `seasonId?` | Award podiums, most-played leaders, participation. Ambassador callsigns / Bounty Hunter hidden while voting is open. |
| `getStandingsData` | `seasonId` (required), `asOfRound?` | Derived season table (best-X nights) + per-night results with phase labels. |
| `getPlayerProfile` | `playerId` (required), `seasonId?` | Full public profile: season stats, career record, badges, leader win-rates. Omits gamification and rivalry. |
| `linkAccount` | `email` (required), `deviceId` (required), `playerId?` | Honor-based email claim + session mint. Returns token and link state. |

## Token-optional actions

Session is resolved if a valid token is present; the handler receives `session` (row or `null`).

| Action | Payload | Description |
|--------|---------|-------------|
| `getAppData` | — | Bootstrap bundle: settings, link status, current vote, seasons. If linked: `linkedPlayer`, `alreadyVoted`, `currentVote`. |
| `getVoteBootstrap` | — | Vote-tab bootstrap: participation count, voting state, week. If linked: attended state, current vote, opponent list. |

## Token-required actions

No valid session → `401`.

| Action | Payload | Description |
|--------|---------|-------------|
| `submitVote` | `voteData: { leaderId, opponentId }` | Submits this week's vote. Validates: voting open, not paused, no duplicate, no self-vote, opponent faced that week. Increments raffle ticket. |
| `updateVote` | `voteData: { leaderId, opponentId }` | Replaces both choices for the current week. `404` if no prior vote (use `submitVote`). |
| `unlinkAccount` | — | Deletes the session for this (player, device) pair only. Other devices untouched. |
| `getMySeasonStats` | `seasonId?` | Linked player's private season stats: tickets, streaks, badges, leader win-rates, awards. |
| `getMyCareerStats` | — | Linked player's private career: record, rivalry, season progression, badges. |

## Admin actions

All require `adminToken` matching `ADMIN_SECRET`.

| Action | Payload | Description |
|--------|---------|-------------|
| `startNewSeason` | `seasonId?` | Creates season row if missing; sets `ACTIVE_SEASON_ID`, `CURRENT_WEEK="Week 1"`, `VOTING_OPEN=FALSE`, `SEASON_STARTED=TRUE`. |
| `triggerWeeklyCycle` | — | Manually invokes the sync lifecycle (idempotent). |
| `pauseCurrentSeason` | — | Sets `SEASON_PAUSED=TRUE` — sync continues, no advance/open/close. |
| `resumeCurrentSeason` | — | Sets `SEASON_PAUSED=FALSE`. |
| `backfillFromMelee` | `seasonId?`, `maxTournaments?`, `resync?` | Historical Melee backfill (bounded batch — Workers 50-subrequest limit). |
| `materializePastAwards` | `seasonId` (required), `dryRun?` | One-time award materialization for S1–S5 only. |
| `addLeaders` | `leaders: [{ name, set? }]` | Inserts non-duplicate leaders. Returns `{ added, skipped }`. |
| `setLeadersActive` | `leaderIds: []`, `active: bool` | Activates or deactivates leaders. |
| `removeLeaders` | `leaderIds: []` | Deletes leaders; refuses any referenced by votes. |

## Session model

- Sessions are per (player, device). Token is a UUID minted at link time.
- 90-day rolling TTL from `last_active` — refreshed on each authenticated request.
- Unlink is device-scoped; other devices of the same player are untouched.
