# Database (D1)

The backend persists everything to a Cloudflare D1 database (SQLite). The schema is defined
in `backend/schema.sql` and applied via:

```sh
cd backend && npx wrangler d1 execute league-tracker --remote --file=schema.sql
```

## Tables

### `settings`
Runtime configuration (replaces the old Settings sheet).

| Column | Type | Notes |
|--------|------|-------|
| `key` | TEXT PRIMARY KEY | e.g. `ACTIVE_SEASON_ID`, `CURRENT_WEEK`, `VOTING_OPEN`, `SEASON_LENGTH` |
| `value` | TEXT NOT NULL | Values are strings; `VOTING_OPEN` is `TRUE`/`FALSE` |

### `players`
Player roster synced from the SWU league site.

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT PRIMARY KEY | e.g. `P001` |
| `name` | TEXT NOT NULL | Display name |
| `melee_name` | TEXT | Melee username from SWU site |
| `email` | TEXT | Google email (linking) |
| `active` | INTEGER | `1` = active, `0` = inactive |

### `leaders`
Leader options for voting.

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT PRIMARY KEY | e.g. `L001` |
| `name` | TEXT NOT NULL | Leader name |
| `set` | TEXT | Card set |
| `active` | INTEGER | `1` = active, `0` = inactive |

Display name shown as `name - set`.

### `seasons`
Season registry.

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PRIMARY KEY | Maps 1:1 to SWU site season number |
| `name` | TEXT NOT NULL | e.g. `Season 6` |
| `created_date` | TEXT | Creation date |

### `sessions`
Per-device session tokens.

| Column | Type | Notes |
|--------|------|-------|
| `token` | TEXT PRIMARY KEY | UUID, per device |
| `player_id` | TEXT NOT NULL | FK → `players.id` |
| `device_id` | TEXT NOT NULL | Browser/device identifier |
| `email` | TEXT | Lowercased, trimmed |
| `created` | TEXT NOT NULL | Immutable creation timestamp |
| `last_active` | TEXT NOT NULL | Rolling timestamp, refreshed on each vote/link |

Sessions expire after 90 days of inactivity (checked against `last_active`, falling back to
`created` for pre-migration rows). Auto-created on first use. A row is deleted when that
device is unlinked, or lazily GC'd when a stale token is presented.

### `leader_votes`
Weekly votes: leader played. One row per player per week.

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PRIMARY KEY AUTOINCREMENT | |
| `timestamp` | TEXT NOT NULL | |
| `season_id` | INTEGER NOT NULL | FK → `seasons.id` |
| `week` | INTEGER NOT NULL | |
| `player_id` | TEXT NOT NULL | FK → `players.id` |
| `leader_id` | TEXT NOT NULL | FK → `leaders.id` |

Constraint: `UNIQUE(season_id, week, player_id)` — enforces one vote per player per week.

### `opponent_votes`
Weekly votes: favorite opponent. De-identified tally only — no voter attribution.

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PRIMARY KEY AUTOINCREMENT | |
| `timestamp` | TEXT NOT NULL | |
| `season_id` | INTEGER NOT NULL | FK → `seasons.id` |
| `week` | INTEGER NOT NULL | |
| `opponent_id` | TEXT NOT NULL | FK → `players.id` |

**Privacy note:** This table intentionally stores only the aggregate tally (which
player received a favorite-opponent vote), never the identity of who cast it.

### `awards`
Materialized award podium. Written once at season close.

| Column | Type | Notes |
|--------|------|-------|
| `season_id` | INTEGER NOT NULL | FK → `seasons.id` |
| `award_name` | TEXT NOT NULL | One of the 5 award names |
| `player_id` | TEXT NOT NULL | FK → `players.id`; empty string for placeholders |
| `score` | REAL | Award-specific score |

Constraint: `PRIMARY KEY (season_id, award_name, player_id)` — idempotent writes.

Every award always receives a row — the resolved winner(s) when the data source is available, or
a placeholder with an empty `player_id` otherwise. Every tied winner is its own row.

### `attendance`
Attendance tracking, inferred from SWU site standings.

| Column | Type | Notes |
|--------|------|-------|
| `season_id` | INTEGER NOT NULL | FK → `seasons.id` |
| `week` | INTEGER NOT NULL | |
| `player_id` | TEXT NOT NULL | FK → `players.id` |

Constraint: `PRIMARY KEY (season_id, week, player_id)`.

## Indexes

```sql
CREATE INDEX idx_leader_votes_season_week ON leader_votes(season_id, week);
CREATE INDEX idx_leader_votes_player ON leader_votes(player_id);
CREATE INDEX idx_opponent_votes_season_week ON opponent_votes(season_id, week);
CREATE INDEX idx_sessions_player ON sessions(player_id);
CREATE INDEX idx_sessions_device ON sessions(device_id);
CREATE INDEX idx_attendance_season ON attendance(season_id, week);
```

## Award computation notes

Awards are computed once at season close (final week per `SEASON_LENGTH`) by
`advanceWeek`, and appended to the `awards` table:

- **Galactic Ruler** — best final placing: rank 1 in the SWU site's round-`SEASON_LENGTH`
  standings. All players tied for rank 1 are recorded.
- **Galactic Schemer** — most distinct leaders played, from `leader_votes`.
- **Galactic Ambassador** — most favorite-opponent votes, from `opponent_votes`.
- **A New Hope** — most places climbed between round `floor(SEASON_LENGTH / 2)` and the final
  round, comparing the SWU site's standings. Only players present in **both** rounds count;
  all tied for the top positive climb are recorded.
- **Bounty Hunter** — **no data source.** Always written as a placeholder row
  whose `player_id` is entered **manually** after the rest of the awards are calculated.

Awards are **idempotent**: each `(season_id, award_name, player_id)` is written at most once per
season. Re-running the close never duplicates existing rows.

Site players are matched primarily by melee name (`players.melee_name` == the site's
`playerUsername`), falling back to the display name (`players.name`). Because awards must not
fail the whole season close, the site-based awards (Galactic Ruler, A New Hope) are recorded as
**empty placeholders** if the SWU site is unreachable or its standings cannot be parsed; the
vote-based awards and the Bounty Hunter placeholder are still written.

## Leaderboard (live award tracking)

The leaderboard always shows the Most Played Leaders (a tracked stat, not an award) and the
vote-based Schemer / Ambassador sections as live failovers. Once all five Awards have been
written at season close, the sections switch to an **awards-first** view: filled `player_id`
rows are rendered as awarded entries. An empty placeholder falls back to the live/vote source
so the board remains useful while a season is still in progress.

**Ambassador reveal gate:** Ambassador identities stay codenames (Gold Leader, etc.) only
while voting is open for the active season. The moment voting closes, real names are revealed.

**Site-based live sections (Galactic Ruler / A New Hope):** while the season is live, these
show a top-3 podium (Ruler) and the top-3 climbers (A New Hope) from the SWU site in real
time. If the site is unreachable these fields are sent as `null` and the section is hidden.

**Bounty Hunter:** never computed from any data source. It is hidden while voting is open and
appears as an empty (or filled) award row only after the season has ended.
