# Database (spreadsheet structure)

The backend persists everything to a single Google Sheets document (`SPREADSHEET_ID`).
It expects the following tabs. Each row is a record; the first row is assumed to be a
header and is skipped.

| Sheet | Columns |
|-------|---------|
| `Settings` | `A` key · `B` value. Keys: `ACTIVE_SEASON_ID`, `CURRENT_WEEK` (e.g. `Week 3`), `VOTING_OPEN` (`TRUE`/`FALSE`) |
| `Players` | `A` id (e.g. `P001`) · `B` name · `C` melee name · `D` Google email (linking) · `E` active (`TRUE`/`FALSE`) |
| `Leaders` | `A` id · `B` leader name · `C` subtitle. Display name shown as `B - C` |
| `Seasons` | `A` id (number) · `B` name (e.g. `Season 4`) · `C` created date |
| `SeasonPlayers` | `A` seasonId · `B` playerId · `C` active (`TRUE`/`FALSE`) |
| `SeasonLeaders` | `A` seasonId · `B` leaderId · `C` active (`TRUE`/`FALSE`) |
| `LeaderVotes` | `A` timestamp · `B` seasonId · `C` week · `D` voter playerId · `E` leaderId (one row per player per week; also used to enforce one submission per week) |
| `OpponentVotes` | `A` timestamp · `B` seasonId · `C` week · `D` opponentId (de-identified tally only — no voter attribution) |
| `SeasonSummary` | `A` timestamp · `B` seasonId · `C` week · `D` top leaderId · `E` leader vote count · `F` top opponentId · `G` opponent vote count |
| `Awards` | `A` seasonId · `B` category (e.g. `Favorite Opponent`) · `C` playerId · `D` player name · `E` votes · `F` timestamp |

`SeasonPlayers` and `SeasonLeaders` control which players/leaders are active for a given
season; if a season row is absent, all master players/leaders are used.

> **Privacy note:** `OpponentVotes` intentionally stores only the aggregate tally (which
> player received a favorite-opponent vote), never the identity of who cast it. This means
> the spreadsheet owner can see vote *counts* for the "Favorite Opponents" top-3 but cannot
> attribute a vote to a voter. Deduplication of weekly submissions is handled entirely by
> `LeaderVotes` (one row per player per week).
