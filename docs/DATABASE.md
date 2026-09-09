# Database (D1)

Cloudflare D1 (SQLite). Schema in `backend/schema.sql`. Applied via:

```sh
cd backend && npx wrangler d1 execute league-tracker --remote --file=schema.sql
```

## Tables

### `settings`
Runtime configuration. Key-value store.

| Column | Type | Notes |
|--------|------|-------|
| `key` | TEXT PRIMARY KEY | e.g. `ACTIVE_SEASON_ID`, `CURRENT_WEEK`, `VOTING_OPEN` |
| `value` | TEXT NOT NULL | Strings; booleans are `TRUE`/`FALSE` |

### `players`
Player roster. Auto-created from Melee data on first sync.

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT PRIMARY KEY | `P###` format, never reused |
| `name` | TEXT NOT NULL | Display name (Melee DisplayName → Name → Username fallback) |
| `melee_name` | TEXT | Melee.gg username — identity join key |
| `melee_guid` | TEXT | Reserved, unpopulated |
| `email` | TEXT | One email ↔ one player |
| `active` | INTEGER | `1` = active, `0` = inactive |

### `leaders`
Leader options for voting.

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT PRIMARY KEY | `L###` format |
| `name` | TEXT NOT NULL | Leader name |
| `set` | TEXT | Card set |
| `active` | INTEGER | `1` = active, `0` = inactive |

### `seasons`
Season registry with configuration.

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PRIMARY KEY | Season number |
| `name` | TEXT NOT NULL | e.g. `Season 7` |
| `created_date` | TEXT | ISO date |
| `length` | INTEGER NOT NULL DEFAULT 11 | Regular nights per season |
| `top_results` | INTEGER NOT NULL DEFAULT 7 | Best X nights for season table |

### `sessions`
Per-device session tokens. 90-day rolling TTL.

| Column | Type | Notes |
|--------|------|-------|
| `token` | TEXT PRIMARY KEY | UUID |
| `player_id` | TEXT NOT NULL | FK → `players.id` |
| `device_id` | TEXT NOT NULL | Browser/device UUID |
| `email` | TEXT | Player email |
| `created` | TEXT NOT NULL | Immutable creation timestamp |
| `last_active` | TEXT NOT NULL | Rolling timestamp, refreshed on use |

Constraint: `UNIQUE(player_id, device_id)`

### `votes`
Merged votes table. One row per player per week, both fields mandatory.

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PRIMARY KEY AUTOINCREMENT | |
| `timestamp` | TEXT NOT NULL | ISO-8601 UTC |
| `updated_at` | TEXT | Set on `updateVote` |
| `season_id` | INTEGER NOT NULL | FK → `seasons.id` |
| `week` | INTEGER NOT NULL | |
| `player_id` | TEXT NOT NULL | FK → `players.id` |
| `leader_id` | TEXT NOT NULL | FK → `leaders.id` |
| `opponent_id` | TEXT NOT NULL | FK → `players.id` |

Constraint: `UNIQUE(season_id, week, player_id)` — one vote per player per week.

**Privacy:** No endpoint or query may expose the voter→opponent mapping. Only aggregate tallies exist.

### `awards`
Materialized award podiums. Written at season close or by `materializePastAwards`.

| Column | Type | Notes |
|--------|------|-------|
| `season_id` | INTEGER NOT NULL | FK → `seasons.id` |
| `award_name` | TEXT NOT NULL | One of 6 awards |
| `player_id` | TEXT NOT NULL | FK → `players.id` |
| `score` | REAL | Award-specific score |

Constraint: `PRIMARY KEY (season_id, award_name, player_id)`

**Six awards:** Galactic Ruler, Galactic Schemer, Galactic Ambassador, A New Hope, Bounty Hunter, Galactic Champion.

### `attendance`
Inferred from regular standings. One row per player per attended week.

| Column | Type | Notes |
|--------|------|-------|
| `season_id` | INTEGER NOT NULL | FK → `seasons.id` |
| `week` | INTEGER NOT NULL | |
| `player_id` | TEXT NOT NULL | FK → `players.id` |

Constraint: `PRIMARY KEY (season_id, week, player_id)`

### `melee_tournaments`
Melee.gg tournament mapping. One row per tournament.

| Column | Type | Notes |
|--------|------|-------|
| `melee_id` | INTEGER PRIMARY KEY | Melee.gg tournament ID |
| `season_id` | INTEGER NOT NULL | FK → `seasons.id` |
| `round` | INTEGER NOT NULL | Sequential by date |
| `name` | TEXT NOT NULL | Tournament name from Melee |
| `date` | TEXT | ISO date from Melee |
| `phase` | TEXT NOT NULL DEFAULT 'regular' | `regular` / `cut` / `side` |

Constraint: `UNIQUE(season_id, round)` — one tournament per round per season.

### `season_standings`
Per-tournament standings from Melee.gg.

| Column | Type | Notes |
|--------|------|-------|
| `season_id` | INTEGER NOT NULL | FK → `seasons.id` |
| `round` | INTEGER NOT NULL | |
| `player_id` | TEXT NOT NULL | FK → `players.id` |
| `wins` | INTEGER DEFAULT 0 | |
| `losses` | INTEGER DEFAULT 0 | |
| `draws` | INTEGER DEFAULT 0 | |
| `match_points` | INTEGER DEFAULT 0 | Night points (3W + D) |
| `rank` | INTEGER | Tournament rank |

Constraint: `PRIMARY KEY (season_id, round, player_id)`

### `match_results`
Match results from Melee.gg.

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PRIMARY KEY AUTOINCREMENT | |
| `season_id` | INTEGER NOT NULL | FK → `seasons.id` |
| `round` | INTEGER NOT NULL | |
| `melee_match_id` | TEXT | Melee.gg Guid (UUID) |
| `player1_id` | TEXT NOT NULL | FK → `players.id` |
| `player2_id` | TEXT NOT NULL | FK → `players.id` |
| `winner_id` | TEXT | NULL for draws |
| `result` | TEXT | e.g. `2-0` |
| `is_bye` | INTEGER DEFAULT 0 | `1` = bye |

Constraint: `UNIQUE(season_id, round, melee_match_id)`

## Indexes

```sql
CREATE INDEX idx_sessions_player ON sessions(player_id);
CREATE INDEX idx_sessions_device ON sessions(device_id);
CREATE INDEX idx_attendance_season ON attendance(season_id, week);
CREATE INDEX idx_attendance_season_player ON attendance(season_id, player_id);
CREATE INDEX idx_votes_season_week ON votes(season_id, week);
CREATE INDEX idx_votes_player ON votes(player_id);
CREATE INDEX idx_melee_tournaments_season ON melee_tournaments(season_id);
CREATE INDEX idx_season_standings_season ON season_standings(season_id, round);
CREATE INDEX idx_match_results_season ON match_results(season_id, round);
```

## Award Computation

| Award | Source | Logic |
|-------|--------|-------|
| **Galactic Ruler** | Season table (derived) | Rank 1 after final regular week; best-X nights; points → undefeated → night-rank sum |
| **Galactic Champion** | Cut tournament standings | Rank 1 of chronologically last cut event |
| **Galactic Schemer** | Votes table | Most distinct leaders played |
| **Galactic Ambassador** | Votes table | Most favorite-opponent votes received |
| **A New Hope** | Season table + mid-season snapshot | Biggest rank climb from raw accumulated standings at ⌊length/2⌋ to derived season table at final regular round |
| **Bounty Hunter** | Season table + match data | Regular-season non-bye wins against previous season's top-4 (from derived season table) |

## Season Table

Derived (not stored): for each player, sum of their best `top_results` night results by night points (3W + D). Tie at boundary keeps earlier night. Ranks: points → undefeated nights → night-rank sum → shared.
