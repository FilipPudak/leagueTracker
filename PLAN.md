# Melee API Integration Plan

**Status:** Draft — ready for implementation
**Date:** 2026-09-06
**Goal:** Replace HTML scraping with Melee.gg API calls, add match history, enable richer features.

---

## Executive Summary

Replace all scraping of `stockholm.sw-unlimited.com` with direct calls to the Melee.gg API. Store match and standings data in D1. Enable: match history, head-to-head records, opponent filtering for voting, and new awards (Bounty Hunter from match data).

---

## Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Player ID | Keep P001 system, add `melee_guid` | P001 is embedded in 5 FK tables; minimal migration |
| Player fields | Only add `melee_guid` | Keep minimal, add more later if needed |
| Schema approach | Enhance existing players table | Simpler than junction table |
| Sync schedule | Wednesday 22:15 (single trigger) | After league night ends at 22:00 |
| Season gating | `SEASON_STARTED` flag | Gates cron between seasons; `VOTING_OPEN` distinguishes first run from advances |
| Schemer/Ambassador | Keep vote-based | Will be populated from S7 onwards |
| Backfill | Regex match on tournament names | As far back as possible |
| Opponent filtering | Show only players faced that week | Requires match data before voting opens |
| Melee auth | HTTP Basic Auth (base64(clientId:clientSecret)) | No OAuth, no token refresh needed |
| Secrets storage | `.env` (local) + Cloudflare dashboard (prod) | Not in `wrangler.toml` |

---

## Season Lifecycle

### Settings

| Setting | Purpose | Set by |
|---|---|---|
| `SEASON_STARTED` | Gates the cron entirely (no work between seasons) | `startNewSeason` sets TRUE, season end sets FALSE |
| `VOTING_OPEN` | Distinguishes first run (open voting) from subsequent runs (advance) | Sync trigger manages |
| `CURRENT_WEEK` | Current week number | `startNewSeason` sets "Week 1", sync advances |

### Timeline (dynamic-length season)

Season length varies per season — determined dynamically from the count of weekly league tournaments in Melee.

| When | `SEASON_STARTED` | `VOTING_OPEN` | `CURRENT_WEEK` | Action |
|---|---|---|---|---|
| Admin starts season | TRUE | FALSE | Week 1 | — |
| Wed 22:15 (run 1) | TRUE | FALSE → TRUE | Week 1 | Open voting, don't advance |
| Players vote Week 1 | TRUE | TRUE | Week 1 | — |
| Wed 22:15 (run 2) | TRUE | TRUE | Week 1 → Week 2 | Advance |
| Players vote Week 2 | TRUE | TRUE | Week 2 | — |
| ... | ... | ... | ... | ... |
| Wed 22:15 (run 11) | TRUE | TRUE | Week 10 → Week 11 | Advance |
| Players vote Week 11 | TRUE | TRUE | Week 11 | — |
| Wed 22:15 (run 12) | TRUE → FALSE | TRUE → FALSE | Week 11 → Season Ended | Close, awards, season end |

### Cron Logic (pseudocode)

```
1. If SEASON_STARTED = FALSE → skip entirely
2. Sync data from Melee API
3. If VOTING_OPEN = FALSE:
      → Set VOTING_OPEN = TRUE
      → Skip advance (first week)
4. Else if nextWeek > seasonLength:
      → Close voting, materialize awards
      → Set SEASON_STARTED = FALSE
5. Else:
      → Advance to next week
```

### `startNewSeason` Sets

- `ACTIVE_SEASON_ID` = new season ID
- `CURRENT_WEEK` = "Week 1"
- `VOTING_OPEN` = FALSE
- `SEASON_STARTED` = TRUE

### Season End Sets

- `VOTING_OPEN` = FALSE
- `CURRENT_WEEK` = "Season Ended"
- `SEASON_STARTED` = FALSE

---

## Melee API Integration

### Authentication

- **Type:** HTTP Basic Auth
- **Header:** `Authorization: Basic base64(CLIENT_ID:CLIENT_SECRET)`
- **Storage:** `.env` (local dev), Cloudflare dashboard encrypted vars (production)
- **No token refresh** — each request independently authenticated

### Rate Limiting

- **Conservative rate:** 1 request per second (configurable)
- **Retry on 429:** Exponential backoff (1s → 2s → 4s → 8s), max 3 retries
- **Retry on 5xx:** Same backoff for server errors
- **Respect headers:** If Melee returns `Retry-After` header, honor it
- **Logging:** Log every 429 hit with URL and retry count

### API Endpoints

| Endpoint | Purpose | Returns |
|---|---|---|
| `GET /api/tournament/list` | List tournaments (paginated, date-filtered) | Tournament DTOs |
| `GET /api/tournament/{id}` | Tournament metadata | Phases, Rounds (derived count) |
| `GET /api/standing/list/current/{id}` | Current standings | Rank, W/D/L, game stats, OMWP |
| `GET /api/match/list/{id}` | All matches for tournament | Players, scores, bye/forfeit flags |
| `GET /api/player/list/{id}` | Tournament participants | Player objects with IDs |

**Note:** All response fields use PascalCase (`Content`, `ID`, `Username`, `GameWins`, etc.).

### API Call Budget

| Call | Count per sync | Notes |
|---|---|---|
| `listTournaments()` | 1 | Paginated, might need 2-3 pages |
| `getStandings(id)` | 12 | One per round |
| `getMatches(id)` | 12 | One per round |
| **Total** | ~25 | At 1 req/sec = ~25 seconds |

### Backfill Budget

| Seasons | Rounds | Calls | Time at 1 req/sec |
|---|---|---|---|
| Season 6 (current) | 12 | 25 | 25 sec |
| Seasons 1-5 (backfill) | 5 × 12 | 120 | ~2 min |
| **Total** | | 145 | ~2.5 min |

---

## Database Schema Changes

### Enhanced `players` table

```sql
ALTER TABLE players ADD COLUMN melee_guid TEXT;
```

### New `melee_tournaments` table

```sql
CREATE TABLE IF NOT EXISTS melee_tournaments (
  melee_id INTEGER PRIMARY KEY,
  season_id INTEGER NOT NULL,
  round_number INTEGER NOT NULL,
  name TEXT,
  synced_at TEXT,
  FOREIGN KEY (season_id) REFERENCES seasons(id),
  UNIQUE(season_id, round_number)
);
```

### New `season_standings` table

```sql
CREATE TABLE IF NOT EXISTS season_standings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  season_id INTEGER NOT NULL,
  round_number INTEGER NOT NULL,
  player_id TEXT,
  melee_username TEXT,
  rank INTEGER,
  points INTEGER,
  match_wins INTEGER,
  match_draws INTEGER,
  match_losses INTEGER,
  game_wins INTEGER,
  game_draws INTEGER,
  game_losses INTEGER,
  omwp REAL,
  synced_at TEXT,
  FOREIGN KEY (season_id) REFERENCES seasons(id),
  UNIQUE(season_id, round_number, melee_username)
);
```

### New `match_results` table

```sql
CREATE TABLE IF NOT EXISTS match_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  season_id INTEGER NOT NULL,
  round_number INTEGER NOT NULL,
  melee_tournament_id INTEGER,
  player1_melee TEXT,
  player2_melee TEXT,
  player1_id TEXT,
  player2_id TEXT,
  player1_wins INTEGER DEFAULT 0,
  player2_wins INTEGER DEFAULT 0,
  draws INTEGER DEFAULT 0,
  winner_id TEXT,
  is_bye INTEGER DEFAULT 0,
  is_forfeit INTEGER DEFAULT 0,
  draw_type TEXT,
  synced_at TEXT,
  FOREIGN KEY (season_id) REFERENCES seasons(id)
);
```

---

## New Files

### `backend/src/lib/melee.js` — API Client

```js
// Exported functions:
listTournaments({ startDateFrom, startDateTo, page, pageSize })
getStandings(tournamentId)
getMatches(tournamentId)
getParticipants(tournamentId)
getTournament(tournamentId)

// Internal:
makeRequest(path)  // Basic Auth, rate limit, retry with backoff
```

### `backend/src/triggers/syncFromMelee.js` — Weekly Sync

**Tournament Naming Patterns (from actual data, 155 SWU tournaments):**

Regular league weeks contain a date (`D/M` or `DD/MM`) in the title:
- Season 1: `SWU Wednesday league {DD/MM}` (no season number)
- Seasons 2-4: `SWU Wednesday league season {N} {DD/MM}` (no explicit week)
- Seasons 5+: `SWU Wednesday league season {N} {DD/MM} (week {W})` (explicit week)

**Excluded tournaments** (contain date but are NOT weekly league rounds):
- `TOP 8`, `TOP 4`, `Best of the Rest`, `Playoff`, `championship`
- `Prerelease`, `Draft`, `clone`, `Budget Draft`
- Non-league: `SWU DL TWI`, `SWU TWI`, `SWU CardExpo`, etc.

**Regex:** `/^SWU Wednesday league(?: season (\d+))?\s+\d{1,2}\/\d{1,2}/i`

This matches all regular weekly league tournaments (with date) across all seasons. Week numbers are derived by sorting matched tournaments by date within each season. Explicit `(week N)` is used when present; otherwise sequential from date order.

Season length varies per season — determined dynamically from the count of matched tournaments.

**Flow:**
1. Check `SEASON_STARTED` → skip if FALSE
2. `listTournaments()` with date range for current season
3. Filter by regex to get season's weekly league tournaments
4. Store/update `melee_tournaments` mapping
5. For each tournament in current season:
   - `getStandings(id)` → match `Username` to `players.melee_name` → store in `season_standings`
   - `getMatches(id)` → match `Competitors[].Team.Players[].Username` → store in `match_results`
6. Record attendance from standings presence
7. Mark all players inactive, re-activate from standings
8. Advance week logic (see Season Lifecycle section)
9. Refresh awards from new data

---

## Modified Files

### `backend/schema.sql`
- Add 3 new tables (melee_tournaments, season_standings, match_results)
- ALTER players ADD COLUMN melee_guid

### `backend/src/db/queries.js`
- Add `isSeasonStarted(settingValue)` helper

### `backend/src/db/data.sql`
- Add `SEASON_STARTED` row to settings

### `backend/src/index.js`
- Import `syncFromMelee` instead of `syncPlayers` and `advanceWeek`
- Change cron schedule to `["15 22 * * 3"]`
- Remove old cron handlers

### `backend/src/handlers/startNewSeason.js`
- Set `SEASON_STARTED = TRUE` instead of `VOTING_OPEN = TRUE`
- Set `VOTING_OPEN = FALSE`

### `backend/src/handlers/getAppData.js`
- Add opponent filtering: when voting is open and match data exists for current round, return only players the voter faced
- Fall back to all active players if no match data

### `backend/src/handlers/getLeaderboardData.js`
- Read Ruler/New Hope from `season_standings` table (not scraping)
- Bounty Hunter: read from `awards` table (computed at season end)
- No more live scraping fallback

### `backend/wrangler.toml`
- Change cron: `["15 22 * * 3"]`
- Remove old crons: `["30 8 * * 1", "0 9 * * 1"]`

### `.env.example`
- Add Melee API credentials:
  ```
  MELEE_CLIENT_ID=
  MELEE_CLIENT_SECRET=
  ```

---

## Deleted Files

| File | Reason |
|---|---|
| `backend/src/lib/scraping.js` | Replaced by `melee.js` |
| `backend/src/triggers/syncPlayers.js` | Replaced by `syncFromMelee.js` |
| `backend/src/triggers/advanceWeek.js` | Merged into `syncFromMelee.js` |

---

## Audit: `votingOpen` Gates

### Gate A — Switch to `seasonStarted`

| File | Line | Current Check | Change |
|---|---|---|---|
| `triggers/advanceWeek.js` | 23 | `if (!votingOpen \|\| !activeSeasonId)` | Switch to `SEASON_STARTED` |
| `triggers/syncPlayers.js` | 24 | `if (!votingOpen \|\| !activeSeasonId)` | Switch to `SEASON_STARTED` |

### Gate B — Keep `votingOpen`

| File | Line | Current Check | Why Keep |
|---|---|---|---|
| `handlers/submitVote.js` | 29-33 | `if (!isVotingOpen(votingOpenVal))` | Core vote-submission gate |

### Gate C — Keep `votingOpen`

| File | Line(s) | What It Gates |
|---|---|---|
| `handlers/getAppData.js` | 14, 67 | Pass-through to frontend |
| `handlers/linkAccount.js` | 56-57, 85 | Pass-through to frontend |
| `handlers/getLeaderboardData.js` | 31, 74, 92, 118, 131 | Privacy masking, round selection |

### Setters

| File | Line | Change |
|---|---|---|
| `handlers/startNewSeason.js` | 24 | Set `SEASON_STARTED=TRUE`, `VOTING_OPEN=FALSE` |
| `triggers/advanceWeek.js` | 94 | Set `VOTING_OPEN=FALSE` (season end) |
| `triggers/advanceWeek.js` | 101 | Remove (voting stays open) |

---

## Frontend: Opponent Filtering

When match data exists for the current round, the opponent dropdown should show only players the voter faced that week.

**Backend query:**
```sql
SELECT DISTINCT
  CASE WHEN mr.player1_id = ? THEN mr.player2_id ELSE mr.player1_id END as id
FROM match_results mr
WHERE mr.season_id = ? AND mr.round_number = ?
  AND (mr.player1_id = ? OR mr.player2_id = ?)
  AND (mr.player1_id IS NOT NULL AND mr.player2_id IS NOT NULL)
```

**Fallback:** If no match data exists, show all active players (current behavior).

---

## New Award: Bounty Hunter (from match data)

**Definition:** Current season match wins vs previous season's top 4 players.

**Computation (at season end):**
```sql
-- Get previous season's top 4
SELECT player_id FROM season_standings
WHERE season_id = ?
AND round_number = (SELECT MAX(round_number) FROM season_standings WHERE season_id = ?)
ORDER BY rank ASC LIMIT 4

-- Count wins against those players this season
SELECT winner_id, COUNT(*) as wins FROM match_results
WHERE season_id = ? AND winner_id IN (prev_top4_ids)
GROUP BY winner_id ORDER BY wins DESC LIMIT 3
```

---

## Test Updates

| Test File | Change |
|---|---|
| `test/helpers/fixtures.js` | Add `SEASON_STARTED` to `basicTables()` and `closedVotingTables()` |
| `test/triggers/advanceWeek.test.js` | Update gate checks, add `SEASON_STARTED` |
| `test/triggers/syncPlayers.test.js` | Update gate checks, add `SEASON_STARTED` |
| `test/handlers/startNewSeason.test.js` | Expect `SEASON_STARTED=TRUE`, `VOTING_OPEN=FALSE` |
| `test/handlers/getAppData.test.js` | Add opponent filtering tests |
| New: `test/lib/melee.test.js` | Melee API client tests |
| New: `test/triggers/syncFromMelee.test.js` | New trigger tests |

---

## Migration Order

1. Add `SEASON_STARTED` to `settings` table (schema + data.sql)
2. Add `melee_guid` column to `players` table
3. Create `melee_tournaments`, `season_standings`, `match_results` tables
4. Add `isSeasonStarted()` to `queries.js`
5. Deploy `melee.js` (API client)
6. Deploy `syncFromMelee.js` (new trigger)
7. Update `startNewSeason.js` (set `SEASON_STARTED`, not `VOTING_OPEN`)
8. Update `index.js` (new cron, new imports)
9. Update `wrangler.toml` (new cron schedule)
10. Update `.env.example` (Melee credentials)
11. Test with current season (Season 6)
12. Update `getAppData.js` (opponent filtering)
13. Update `getLeaderboardData.js` (read from DB)
14. Update fixtures and tests
15. Remove `scraping.js`, `syncPlayers.js`, `advanceWeek.js`
16. Run backfill for historical seasons

---

## Edge Cases

| Edge Case | Handling |
|---|---|
| First sync after `startNewSeason` | `VOTING_OPEN=FALSE` → opens voting, doesn't advance |
| Melee API down during sync | Retry with backoff, log error, skip that round |
| 429 rate limit hit | Exponential backoff (1s→2s→4s→8s), max 3 retries |
| Player username mismatch | Log unresolved matches, manual fix via admin |
| No match data for opponent filtering | Fall back to all active players |
| Season ends, no match data for Bounty Hunter | Insert placeholder (current behavior) |
| Historical seasons have no Melee data | Backfill with regex matching on tournament names |
| Tournament name pattern changes | Make regex configurable in settings table |

---

## Melee API Data Fields

**All fields use PascalCase.** Confirmed from live API probe.

### Standing Object
```
Rank, Points
MatchWins, MatchDraws, MatchLosses, MatchCount
GameWins, GameDraws, GameLosses, GameCount
OpponentMatchWinPercentage, OpponentGameWinPercentage, TeamGameWinPercentage
RoundNumber, PhaseId, TournamentId
TeamId
Team.ID, Team.Players[].ID, Team.Players[].Username, Team.Players[].DisplayName
```

### Match Object
```
Competitors[].Team.ID, Competitors[].Team.Players[].ID, Competitors[].Team.Players[].Username
Competitors[].GameWins, Competitors[].GameByes
Competitors[].TeamId, Competitors[].ID
ByeReason (null = no bye), ByeReasonDescription
RoundNumber, RoundId, PhaseId, TournamentId
GameDraws, HasResult, ResultString, Type, TypeDescription
```

### Tournament Object
```
ID, Guid, Name, Game, Status, StatusDescription
Formats[], OrganizationId, OrganizationName, SearchTags
CurrentPhaseId, LastPairDateTime
Phases[].ID, Phases[].Name, Phases[].Rounds[].ID, Phases[].Rounds[].Name, Phases[].Rounds[].SortOrder
```
**Note:** No `NumberOfRounds` field — derive from `Phases[0].Rounds.length`.

### Player Object
```
ID, Username, DisplayName, FirstName, LastName, PlayerName
TeamId, TournamentId, Status, StatusDescription
AsmoConnectId, Email
```

---

## Backfill Strategy

1. Call `listTournaments()` with date ranges for each past season
2. Match tournaments by regex: `/^SWU Wednesday league(?: season (\d+))?\s+\d{1,2}\/\d{1,2}/i`
3. For each matched tournament:
   - Extract season number from group 1 (null = season 1)
   - Sort tournaments by date within season to determine round order
   - If `(week (\d+))` present, use that as round number; otherwise use position
4. Fetch standings and matches for each tournament
5. Store in new tables
6. Compute awards retroactively

Season length is dynamic — determined from the count of matched tournaments per season (not assumed 11).

This can be run as a one-time script or triggered manually via admin action.

---

## Known Limitations

- Melee API is tournament-ID-based only (no search endpoint)
- Tournament discovery relies on name pattern matching
- Players don't report decklists in Melee (leader dropdown stays manual)
- Bounty Hunter requires previous season's top 4 (won't work for Season 1)
- No cross-tournament player history endpoint (must aggregate per-tournament)
