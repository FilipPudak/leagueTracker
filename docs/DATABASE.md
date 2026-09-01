# Database (spreadsheet structure)

The backend persists everything to a single Google Sheets document (`SPREADSHEET_ID`).
It expects the following tabs. Each row is a record; the first row is assumed to be a
header and is skipped.

| Sheet | Columns |
|-------|---------|
| `Settings` | `A` key · `B` value. Keys: `ACTIVE_SEASON_ID`, `CURRENT_WEEK` (e.g. `Week 3`), `VOTING_OPEN` (`TRUE`/`FALSE`), `SEASON_LENGTH` (required, e.g. `11`; configured manually, never written by code — a missing/invalid value makes season close fail loudly) |
| `Players` | `A` id (e.g. `P001`) · `B` name · `C` melee name · `D` Google email (linking) · `E` active (`TRUE`/`FALSE`) |
| `Leaders` | `A` id · `B` leader name · `C` set · `D` active (`TRUE`/`FALSE`). Display name shown as `B - C` |
| `Seasons` | `A` id (number) · `B` name (e.g. `Season 4`) · `C` created date. The season id maps 1:1 to the SWU site's season number (`/season/{n}/round/{r}`) |
| `LeaderVotes` | `A` timestamp · `B` seasonId · `C` week · `D` voter playerId · `E` leaderId (one row per player per week; also used to enforce one submission per week) |
| `OpponentVotes` | `A` timestamp · `B` seasonId · `C` week · `D` opponentId (de-identified tally only — no voter attribution) |
| `Awards` | `A` seasonId · `B` award · `C` playerId. Written once at season close (final week, per `SEASON_LENGTH`). `award` ∈ `Galactic Ruler`, `Galactic Schemer`, `Galactic Ambassador`, `A New Hope`, `Bounty Hunter`. Every tied winner is recorded as its own row. This is immutable history — never rewritten. |

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

## Award computation notes

Awards are computed once at season close (final week per `SEASON_LENGTH`) by
`calculateSeasonAwards`, called from `advanceLeagueWeek`, and appended to `Awards`:

- **Galactic Ruler** — best final placing: rank 1 in the SWU site's round-`SEASON_LENGTH`
  standings (`https://stockholm.sw-unlimited.com/season/{id}/round/{n}`, base overridable via
  the `SCRAPE_URL` config). All players tied for rank 1 are recorded.
- **Galactic Schemer** — most distinct leaders played, from `LeaderVotes`.
- **Galactic Ambassador** — most favorite-opponent votes, from `OpponentVotes`.
- **A New Hope** — most places climbed between round `floor(SEASON_LENGTH / 2)` and the final
  round, comparing the SWU site's standings. Only players present in **both** rounds count;
  all tied for the top positive climb are recorded.
- **Bounty Hunter** — **no data source.** At season close the code writes a placeholder row
  `[seasonId, 'Bounty Hunter', '']` whose `playerId` is entered **manually** after the rest
  of the awards are calculated.

Site players are matched to `Players` primarily by melee name (`Players` col C == the site's
`playerUsername`), falling back to the display name (`Players` col B). Because awards must not
fail the whole season close, the site-based awards (Galactic Ruler, A New Hope) are **skipped
silently** if the SWU site is unreachable or its standings cannot be parsed; the vote-based
awards and the Bounty Hunter placeholder are still written. The site is public (no auth), the
same source the existing `syncPlayersFromWebsite` already scrapes. A season's id matches the
site season number 1:1.

