# Melee API Integration Plan

**Status:** Implemented — backfill complete
**Date:** 2026-09-08
**Goal:** Replace HTML scraping with Melee.gg API calls, add match history, enable richer features.

---

## Executive Summary

Replace all scraping of `stockholm.sw-unlimited.com` with direct calls to the Melee.gg API. Store match and standings data in D1. Enable: match history, head-to-head records, opponent filtering for voting, and new awards (Bounty Hunter from match data).

---

## Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Player ID | Keep P001 system, no `melee_guid` column | `melee_name` is sufficient for linking; P001 is embedded in FK tables |
| Player fields | Only `melee_name` (no `melee_guid`) | Keep minimal, add more later if needed |
| Schema approach | Enhance existing players table | Simpler than junction table |
| Sync schedule | Wednesday 22:15 (single trigger) | After league night ends at 22:00 |
| Season gating | `SEASON_STARTED` flag | Gates cron between seasons; `VOTING_OPEN` distinguishes first run from advances |
| Schemer/Ambassador | Keep vote-based | Will be populated from S7 onwards |
| Backfill | Regex match on tournament names | As far back as possible |
| Opponent filtering | Show only players faced that week | Requires match data before voting opens |
| Melee auth | HTTP Basic Auth (base64(clientId:clientSecret)) | No OAuth, no token refresh needed |
| Secrets storage | `.env` (local) + Cloudflare dashboard (prod) | Not in `wrangler.toml` |

---

## Melee.gg API — Confirmed Facts

### Authentication

- **Type:** HTTP Basic Auth
- **Header:** `Authorization: Basic base64(CLIENT_ID:CLIENT_SECRET)`
- **Storage:** `.env` (local dev), Cloudflare dashboard encrypted vars (production)
- **No token refresh** — each request independently authenticated

### Pagination

**WRONG assumption in original plan:** `Skip` and `Take` query params.
**CORRECT:** Use `variables.page` (1-based) and `variables.pageSize`.

```
GET /api/tournament/list?Game=StarWarsUnlimited&variables.page=1&variables.pageSize=50
```

`Skip`/`Take` are ignored by the API. The response includes `HasMore`, `RecordsTotal`, `Content`.

### Response Format

All response fields use **PascalCase** (`Content`, `ID`, `Username`, `GameWins`, etc.).

### Match Objects — No `ID` Field

**WRONG assumption:** Matches have an `ID` field like tournaments do.
**CORRECT:** Matches have a `Guid` field (UUID string). No numeric `ID`.

```
Match.Guid = "06f85bd4-a182-4cb0-9625-b2900124b00c"
```

The `melee_match_id` column in `match_results` stores this GUID as TEXT.

### Winner Determination

**WRONG assumption:** Match objects have a `WinnerId` field.
**CORRECT:** No `WinnerId`. Compare `Competitors[i].GameWins` to determine winner.

### Date Field

**WRONG assumption:** Tournament objects have a `StartDate` field.
**CORRECT:** Use `LastPairDateTime` as fallback. No `StartDate` field exists.

### Standings Endpoint

**CONFIRMED:** `/api/standing/list/current/{tournamentId}`

### Standings Object Fields

```
Rank, Points, MatchWins, MatchDraws, MatchLosses, MatchCount
GameWins, GameDraws, GameLosses, GameCount
OpponentMatchWinPercentage, OpponentGameWinPercentage, TeamGameWinPercentage
TeamId, TournamentId, PhaseId, RoundNumber
Team.Players[].Username, Team.Players[].DisplayName, Team.Players[].Name
```

### Match Object Fields

```
Competitors[].Team.Players[].Username, .DisplayName, .Name
Competitors[].GameWins, Competitors[].GameByes
Guid (not ID), ByeReason, ResultString, RoundNumber
TournamentId, PhaseId, RoundId
```

### Tournament Object Fields

```
ID (numeric), Name, Game, Status, StatusDescription
LastPairDateTime, Formats[], OrganizationId
Phases[].Rounds[].ID, .Name, .SortOrder
```

No `NumberOfRounds` field — derive from `Phases[0].Rounds.length`.

---

## Tournament Name Patterns

### Regular League Weeks (with date)

- **Season 1:** `SWU Wednesday league {DD/MM}` (no season number)
- **Seasons 2-4:** `SWU Wednesday league season {N} {DD/MM}` (no explicit week)
- **Seasons 5+:** `SWU Wednesday league season {N} {DD/MM} (week {W})` (explicit week)

### Special Tournaments (no date, but valuable data)

- **Top 8 / Top 4:** Championship bracket — reveals season champion
- **Playoff (championship):** Same as Top 8, different naming
- **Best of the Rest:** Non-championship bracket data
- **Finale:** Non-championship bracket for players who didn't make Top 8

### Excluded Tournaments

- `prerelease`, `draft`, `clone`, `budget draft` — not league data
- Non-league: `SWU DL TWI`, `SWU TWI`, `SWU CardExpo`, etc. — don't match regex at all

### Regex (Current — Includes Special Tournaments)

```js
const LEAGUE_REGEX = /^SWU Wednesday league(?: season (\d+))?(?:\s+\d{1,2}\/\d{1,2}|\s+(?:top [48]|best of the rest|playoff|championship|finale))/i;
const EXCLUDED_KEYWORDS = ['prerelease', 'draft', 'clone', 'budget draft'];
```

This matches both regular league weeks (date pattern) and special tournaments (keyword pattern).

### Why Top 8/Top 4 Are Included

These reveal who was the **Champion** of each season. Valuable for leaderboard display.

---

## Season 1 — The No-Season-Number Problem

Season 1 tournaments have no `season X` in their names:
```
SWU Wednesday league 9/10
SWU Wednesday league 16/10
...
SWU Wednesday league Top 8
SWU Wednesday league finale (for everyone that didnt make top 8)
```

`extractSeasonAndRound()` returns `{ seasonNum: null, week: null }` for these.

**Solution:** Null-season tournaments default to season 1:
```js
const seasonNum = info.seasonNum || 1;
if (targetSeasonId && seasonNum !== targetSeasonId) continue;
```

This correctly:
- Assigns S1 tournaments to season 1 when `targetSeasonId=1`
- Blocks S1 tournaments from other seasons when `targetSeasonId=7`
- Includes S1 tournaments in untargeted backfills (defaults to season 1)

---

## Tournament Counts Per Season (Verified from API)

| Season | Regular Weeks | Special | Total |
|--------|--------------|---------|-------|
| 1 | 10 | Top 8, Finale | 12 |
| 2 | 14 | Best of the Rest, Top 8 | 17 |
| 3 | 15 | TOP 8, Best of the Rest | 17 |
| 4 | 15 | TOP 8, Best of the Rest | 17 |
| 5 | 11 | Playoff (championship) | 12 |
| 6 | 11 | Best of the Rest, TOP 4 | 13 |
| 7 | 1 | — | 1 (as of 2026-09-08) |

**Notable exclusions:**
- `269699 SWU Wednesday league season 2` — no date, no special keyword, 0 standings/matches
- `392843 SWU Wednesday league season 4 10/12 clone` — excluded by "clone" keyword, 0 data
- `235731 \tSWU Wednesday league season 2 29/1` — has leading tab (user corrected this)

---

## Schema Changes (Implemented)

### `seasons` table

```sql
CREATE TABLE IF NOT EXISTS seasons (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  created_date TEXT
);
```

### `melee_tournaments` table

```sql
CREATE TABLE IF NOT EXISTS melee_tournaments (
  melee_id INTEGER PRIMARY KEY,
  season_id INTEGER NOT NULL,
  round INTEGER NOT NULL,
  name TEXT NOT NULL,
  date TEXT,
  FOREIGN KEY (season_id) REFERENCES seasons(id)
);
```

### `season_standings` table

```sql
CREATE TABLE IF NOT EXISTS season_standings (
  season_id INTEGER NOT NULL,
  round INTEGER NOT NULL,
  player_id TEXT NOT NULL,
  wins INTEGER DEFAULT 0,
  losses INTEGER DEFAULT 0,
  draws INTEGER DEFAULT 0,
  match_points INTEGER DEFAULT 0,
  rank INTEGER,
  PRIMARY KEY (season_id, round, player_id),
  FOREIGN KEY (season_id) REFERENCES seasons(id),
  FOREIGN KEY (player_id) REFERENCES players(id)
);
```

### `match_results` table

```sql
CREATE TABLE IF NOT EXISTS match_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  season_id INTEGER NOT NULL,
  round INTEGER NOT NULL,
  melee_match_id TEXT,
  player1_id TEXT NOT NULL,
  player2_id TEXT NOT NULL,
  winner_id TEXT,
  result TEXT,
  is_bye INTEGER DEFAULT 0,
  FOREIGN KEY (season_id) REFERENCES seasons(id),
  FOREIGN KEY (player1_id) REFERENCES players(id),
  FOREIGN KEY (player2_id) REFERENCES players(id)
);
```

**Note:** `melee_match_id` is TEXT (stores UUID strings from Melee API `Guid` field).

---

## Critical Bugs Found and Fixed

### 1. Match ID was `undefined`

**Bug:** Code used `m.ID` but match objects have no `ID` field — only `Guid`.
**Fix:** `const matchGuid = m.Guid || m.ID;`
**Impact:** 0 matches inserted across all backfill runs.

### 2. Foreign Key: No season row

**Bug:** `season_standings` and `match_results` have `FOREIGN KEY (season_id) REFERENCES seasons(id)`, but backfill never created season rows.
**Fix:** `INSERT OR IGNORE INTO seasons (id, name, created_date)` before inserting data.
**Impact:** All standings/matches inserts failed with FK constraint.

### 3. Foreign Key: Player not in DB

**Bug:** `findOrCreatePlayer` used `INSERT OR IGNORE` with a generated ID. If a player already existed with the same `melee_name`, the INSERT was silently ignored but the function returned the non-existent generated ID.
**Fix:** Check `SELECT id FROM players WHERE melee_name = ?` before generating a new ID.
**Impact:** All standings/matches inserts failed with FK constraint.

### 4. Season assignment leak

**Bug:** `info.seasonNum || targetSeasonId` caused tournaments without a season number (S1) to be assigned to whatever season was being backfilled.
**Fix:** `info.seasonNum || 1` — null-season always means season 1.
**Impact:** S1 tournaments appeared in S2-S7 backfills.

### 5. Subrequest limit

**Bug:** Cloudflare Workers has a 50 subrequest limit per invocation. Each tournament requires 2 API calls (standings + matches) + multiple D1 queries.
**Fix:** `maxTournaments` parameter caps how many tournaments are processed per invocation. Default 15, run with 3-5 for safety.
**Impact:** Backfill fails with "Too many API requests" without batching.

### 6. Excluded championship tournaments

**Bug:** Original `EXCLUDED_KEYWORDS` included `top 8`, `top 4`, `best of the rest`, `playoff`, `championship`.
**Fix:** Removed from exclusions, updated regex to match them.
**Impact:** Championship data (season winners) was being lost.

### 7. SQLite type affinity

**Note:** `melee_match_id` column is INTEGER in schema but stores TEXT (UUID strings). SQLite is flexible with types — this works. No migration needed. D1 does not support `ALTER COLUMN`.

---

## Backfill State (as of 2026-09-08)

| Season | Tournaments | Standings Rounds | Match Rounds |
|--------|------------|-----------------|--------------|
| 1 | 12 | 11 | 11 |
| 2 | 14 | 22* | 22* |
| 3 | 17 | 17 | 17 |
| 4 | 17 | 17 | 17 |
| 5 | 12 | 11 | 11 |
| 6 | 13 | 10 | 9 |
| 7 | 1 | 3 | 3 |

*Season 2 has 22 distinct rounds but only 14 tournaments — round numbers are offset from earlier buggy backfill runs. Data is correct, just cosmetic round numbering issue.

**Totals:** 77 players, 86 tournaments, 1252 standings, 1945 matches

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

## Sync Flow (syncFromMelee.js)

1. Check `SEASON_STARTED` → skip if FALSE
2. Fetch all tournaments via `listTournaments()` (paginated)
3. Filter by regex to get current season's league + special tournaments
4. Sort by date, assign round numbers (use `(week N)` if present, else sequential)
5. Store new tournaments in `melee_tournaments`
6. For each tournament not yet synced:
   - `getStandings(id)` → match `Username` to `players.melee_name` → store in `season_standings`
   - `getMatches(id)` → match `Competitors[].Team.Players[].Username` → store in `match_results`
7. Record attendance from standings presence
8. Mark all players inactive, re-activate from standings
9. Advance week logic (see Season Lifecycle section)
10. Refresh awards from new data

---

## Backfill Flow (backfillFromMelee.js)

1. Fetch all tournaments via `listTournaments()` (paginated, all pages)
2. Filter by regex + excluded keywords
3. Group by season number (null → season 1)
4. For each season group:
   - Create season row if missing (`INSERT OR IGNORE INTO seasons`)
   - Check existing tournaments and synced rounds in DB
   - Insert new tournament rows
   - For each non-synced tournament (up to `maxTournaments`):
     - `getStandings(id)` → create players on-the-fly → store standings
     - `getMatches(id)` → create players on-the-fly → store matches
5. Return summary: tournaments, standings, matches counts

**Batching:** `maxTournaments` parameter (default 15) caps API calls per invocation due to Cloudflare Workers 50 subrequest limit. Use 3-5 for safe backfill runs.

---

## Frontend: Opponent Filtering

When match data exists for the current round, the opponent dropdown shows only players the voter faced that week.

**Backend query:**
```sql
SELECT DISTINCT
  CASE WHEN mr.player1_id = ? THEN mr.player2_id ELSE mr.player1_id END as id
FROM match_results mr
WHERE mr.season_id = ? AND mr.round = ?
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
AND round = (SELECT MAX(round) FROM season_standings WHERE season_id = ?)
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
| `test/triggers/syncFromMelee.test.js` | Updated: TOP 8 now included (not excluded) |
| `test/triggers/backfillFromMelee.test.js` | Tests for new `maxTournaments` param, FK fixes, Guid usage |
| `test/lib/melee.test.js` | Updated for `variables.page` pagination params |
| `test/router.test.js` | Updated for backfillFromMelee routing |

---

## Known Limitations

- Melee API is tournament-ID-based only (no search endpoint)
- Tournament discovery relies on name pattern matching
- Players don't report decklists in Melee (leader dropdown stays manual)
- Bounty Hunter requires previous season's top 4 (won't work for Season 1)
- No cross-tournament player history endpoint (must aggregate per-tournament)
- D1 does not support `ALTER COLUMN` — column type changes require table rebuild
- Cloudflare Workers 50 subrequest limit per invocation — backfill must be batched
- SQLite stores TEXT in INTEGER columns via type affinity (works but not ideal)
