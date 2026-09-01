# Database (spreadsheet structure)

The backend persists everything to a single Google Sheets document (`SPREADSHEET_ID`).
It expects the following tabs. Each row is a record; the first row is assumed to be a
header and is skipped.

| Sheet | Columns |
|-------|---------|
| `Settings` | `A` key · `B` value. Keys: `ACTIVE_SEASON_ID`, `CURRENT_WEEK` (e.g. `Week 3`), `VOTING_OPEN` (`TRUE`/`FALSE`) |
| `Players` | `A` id (e.g. `P001`) · `B` name · `C` melee name · `D` Google email (linking) · `E` active (`TRUE`/`FALSE`) |
| `Leaders` | `A` id · `B` leader name · `C` set · `D` active (`TRUE`/`FALSE`). Display name shown as `B - C` |
| `Seasons` | `A` id (number) · `B` name (e.g. `Season 4`) · `C` created date |
| `LeaderVotes` | `A` timestamp · `B` seasonId · `C` week · `D` voter playerId · `E` leaderId (one row per player per week; also used to enforce one submission per week) |
| `OpponentVotes` | `A` timestamp · `B` seasonId · `C` week · `D` opponentId (de-identified tally only — no voter attribution) |
| `Awards` | `A` seasonId · `B` award · `C` playerId. Written once at season close (week 11). `award` ∈ `Favorite Opponent`, `Diversity`, `Loyalty`. Every tied winner is recorded as its own row. This is immutable history — never rewritten. |

The `Players` and `Leaders` **`active`** columns gate who is selectable as a vote
option in the current season. Historical leaderboards are computed on demand from the raw
vote tables (`LeaderVotes` / `OpponentVotes`), which retain their `seasonId` for every
row, so they are unaffected by current active status.

> **Privacy note:** `OpponentVotes` intentionally stores only the aggregate tally (which
> player received a favorite-opponent vote), never the identity of who cast it. This means
> the spreadsheet owner can see vote *counts* for the "Favorite Opponents" top-3 but cannot
> attribute a vote to a voter. Deduplication of weekly submissions is handled entirely by
> `LeaderVotes` (one row per player per week).

The **My Stats** endpoint (`getMySeasonStats`) reads a linked player's awards won from
`Awards` for the selected season, and recomputes their per-leader play counts on demand from
`LeaderVotes`. "Most Played Leader" is **not** an award — it is a tracked leader-usage stat
shown only on the live leaderboard.

