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
| `LeaderVotes` | `A` timestamp · `B` seasonId · `C` week · `D` voter playerId · `E` leaderId · `F` constant `1` |
| `OpponentVotes` | `A` timestamp · `B` seasonId · `C` week · `D` opponent playerId · `E` voter playerId |
| `SubmissionLog` | `A` timestamp · `B` seasonId · `C` week · `D` playerId (used to enforce one submission per week) |
| `SeasonSummary` | `A` timestamp · `B` seasonId · `C` week · `D` top leaderId · `E` leader vote count · `F` top opponentId · `G` opponent vote count |
| `Awards` | `A` seasonId · `B` category (e.g. `Favorite Opponent`) · `C` playerId · `D` player name · `E` votes · `F` timestamp |

`SeasonPlayers` and `SeasonLeaders` control which players/leaders are active for a given
season; if a season row is absent, all master players/leaders are used.
