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
| `Awards` | `A` seasonId · `B` award · `C` playerId. Written once at season close (final week, per `SEASON_LENGTH`). `award` ∈ `Galactic Ruler`, `Galactic Schemer`, `Galactic Ambassador`, `A New Hope`, `Bounty Hunter`. **Every award gets a row**: winner(s) when resolved, otherwise a placeholder with an empty `playerId` that is filled in later (manually for Bounty Hunter, via `backfillSeasonAwards` otherwise). Every tied winner is its own row. Once written, a row is never overwritten by the close itself. |
| `Sessions` | `A` token (UUID, per device) · `B` playerId · `C` deviceId · `D` email (lowercased, trimmed) · `E` created timestamp. **Many sessions map to one player** (one per device). Auto-created on first use if the sheet is missing. A row is deleted when that device is unlinked, or lazily GC'd when a stale token (e.g. after an admin unclaim) is presented on a request. Players col D (email claim) is kept on unlink so the player stays claimed by their email. |

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
`calculateSeasonAwards`, called from `advanceLeagueWeek`, and appended to `Awards`. Every
award always receives a row — the resolved winner(s) when the data source is available, or a
placeholder with an empty `playerId` otherwise:

- **Galactic Ruler** — best final placing: rank 1 in the SWU site's round-`SEASON_LENGTH`
  standings (`https://stockholm.sw-unlimited.com/season/{id}/round/{n}`, base overridable via
  the `SCRAPE_URL` config). All players tied for rank 1 are recorded.
- **Galactic Schemer** — most distinct leaders played, from `LeaderVotes`.
- **Galactic Ambassador** — most favorite-opponent votes, from `OpponentVotes`.
- **A New Hope** — most places climbed between round `floor(SEASON_LENGTH / 2)` and the final
  round, comparing the SWU site's standings. Only players present in **both** rounds count;
  all tied for the top positive climb are recorded.
- **Bounty Hunter** — **no data source.** Always written as a placeholder row
  `[seasonId, 'Bounty Hunter', '']` whose `playerId` is entered **manually** after the rest
  of the awards are calculated. Once filled in, it shows up for that player in My Stats like
  any other award.

Awards are **idempotent**: each `[seasonId, award]` is written at most once per season.
Re-running the close (e.g. a retry after the site was unreachable) never duplicates existing
rows. A placeholder written during a site-down close can still be resolved later by
`backfillSeasonAwards`.

Site players are matched to `Players` primarily by melee name (`Players` col C == the site's
`playerUsername`), falling back to the display name (`Players` col B). Because awards must not
fail the whole season close, the site-based awards (Galactic Ruler, A New Hope) are recorded as
**empty placeholders** if the SWU site is unreachable or its standings cannot be parsed; the
vote-based awards and the Bounty Hunter placeholder are still written. The site is public (no
auth), the same source the existing `syncPlayersFromWebsite` already scrapes. A season's id
matches the site season number 1:1.

## Leaderboard (live award tracking)

The leaderboard (`handleGetLeaderboardData`) always shows the Most Played Leaders (a tracked
stat, not an award) and the vote-based Schemer / Ambassador sections as live failovers. Once
all five Awards have been written at season close, the sections switch to an **awards-first**
view: filled `playerId` rows are rendered as `"Awarded"` entries. An empty placeholder falls
back to the live/vote source so the board remains useful while a season is still in progress.

**Ambassador reveal gate:** Ambassador identities stay codenames (`Gold Leader`, etc.) only
while `isActiveSeason && isVotingOpen(settings)`. The moment voting closes — even before
`startNewSeason` resets the settings — real names are revealed. The Schemer section was never
obfuscated.

**Site-based live sections (Galactic Ruler / A New Hope):** while the season is live, these
show a top-3 podium (Ruler) and the top-3 climbers (A New Hope) from the SWU site in real
time, so there is a preview before the awards are finalized. The fetched round is the
`CURRENT_WEEK` from Settings; once voting closes (or for historical seasons) the final round
(`SEASON_LENGTH`) is used instead, because `CURRENT_WEEK` belongs to the active season only.
If the site is unreachable these fields are sent as `null` and the section is hidden.

**Bounty Hunter:** never computed from any data source. It is hidden while voting is open and
appears as an empty (or filled) award row only after the season has ended.

