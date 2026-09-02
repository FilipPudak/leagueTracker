# Plan: Awards sheet becomes the season's podium (status-free)

## Goal
Replace the legacy award-ledger machinery with a single `Awards` sheet holding a
materialized, status-free podium: 15 rows per season (5 awards x 3 rows,
`[SEASON_ID, AWARD, PLAYER_ID, SCORE]`). The leaderboard and my-stats read these
rows instead of scraping the SWU site or scanning vote sheets per request. Only
the ACTIVE season is ever refreshed; historical seasons read purely from the sheet.

## Schema
Append one column to the existing sheet:
`[SEASON_ID, AWARD, PLAYER_ID, SCORE]`

- SCORE = points (Ruler), places climbed (New Hope), distinct-leaders count
  (Schemer), opponent-votes count (Ambassador), owner-filled value (Bounty).
- No STATUS column, no separate POINTS column. 15 rows/season (5 awards x 3).

## The single writer: `refreshAwardsPodium(seasonId)`

Guards:
- Only runs when `String(seasonId) === String(activeSeasonId)`. Non-active
  (historical) seasons are never touched.
- Round formula (shared helper): `(votingOpen && weekInSeason) ? currentWeek
  : seasonLength`. Only ever selects a round of the ACTIVE season. Never scrapes
  historical data. After close `CURRENT_WEEK` is `'Season Ended'` which
  `parseWeek` reads as 1, so the else-branch (`seasonLength`) must be used.

Behavior:
- Creates each of the 5 awards x 3 rows on first run; re-run overwrites the
  existing first-3 slots in place (never delete rows; blank any excess to keep
  exactly 3, including legacy blocks with 4+ rows).
- Auto-fills PLAYER_ID + SCORE for 4 awards:
  - Galactic Ruler: top-3 by (rank, points) from current/final round standings
    (sort by rank then points so rank 1 is always the lowest row index).
  - A New Hope: top-3 by climb (mid-round vs comparison round).
  - Galactic Schemer: top-3 by distinct leaders/player from LeaderVotes.
  - Galactic Ambassador: top-3 by opponent-vote count from OpponentVotes.
- Bounty Hunter: creates 3 rows, then is NEVER written to again (manual entry,
  same "write-3-leave-alone" treatment as the others but with no computed values).

Call sites:
1. `syncPlayersFromWebsite` - add `refreshAwardsPodium(activeSeasonId)` inside the
   existing voting-open path (no guard restructuring).
2. `advanceLeagueWeek` close path - replace `calculateSeasonAwards(seasonId)`,
   run BEFORE the VOTING_OPEN / CURRENT_WEEK settings flip so the final week is
   captured with voting still open (formula still yields `seasonLength` if closed).

## Shared helpers (single definition, used by writer + read fallback)
- `failoverRound` formula helper.
- `fetchTopRankEntries`, `fetchTopClimbEntries`.
- Vote tallies: `leaderCounts`, `opponentCounts`, schemer/ambassador counts.

These move OUT of the read path into shared standalone functions reused by both
`refreshAwardsPodium` and the leaderboard fallback. No duplication, no drift.

Note: `refreshAwardsPodium` is called from triggers (no `req`), so it must call
`fetchSeasonStandings` without memoization (1-2 fetches/day, within budget).

## Leaderboard read (`handleGetLeaderboardData`)
- All 5 awards: read the block -> first 3 non-empty rows -> `assignStandardRanks`
  by SCORE -> entry shape (displayRank, name, score, subtitle).
- Ambassador keeps live codename obfuscation while `isLive` (applied to
  podium-sourced entries the same way as today's live entries).
- Fallback (block missing or all rows empty, ACTIVE season only):
  - Ruler / New Hope -> live site scrape.
  - Schemer / Ambassador -> live vote tally (vote-sheet reads only on fallback).
  - Bounty -> nothing.
- Historical seasons: sheet-only, never scraped.
- Removed from read path: `seasonAwards` map, `awardedEntries`, the awards-first
  branches, duplicate vote tallies. `assignStandardRanks` and
  `fetchSeasonStandings` stay.
- Fast path (blocks exist) touches neither site nor vote sheets: `siteFetches === 0`
  and `voteReads === 0` for the ACTIVE season.

## my-stats "awards won"
- All awards: winners = all rows sharing the block's max SCORE (ties = several).
  Applies to Bounty too, so fill only the winner's row to get a single win.
- Ruler: single winner = max SCORE + lowest sheet row index (rank 1 always wins).

## Removals (dead code)
- `calculateSeasonAwards`
- `computeAwardWinners` / `computeAwardWinnersUncached`
- `backfillSeasonAwards` / `backfillSeasonAwardsUnlocked`
- `advanceLeagueWeek` close path calls `refreshAwardsPodium` instead.
- `handleSubmitVote` and its tests unchanged. `fetchSeasonStandings` stays.

## Tests & mock
- `test/fixtures.js`: Awards header -> 4 cols; preset rows gain SCORE.
- `test/mockSheets.js`: add `siteFetches` and `voteReads` counters.
- tier3: replace `calculateSeasonAwards` / `backfillSeasonAwards` describes (~15
  tests) with `refreshAwardsPodium`:
  - first run creates 15 rows (5 x 3),
  - re-run overwrites in place (no dups, no row drift),
  - legacy 4+ row block normalizes to exactly 3,
  - Ruler points (rank-sorted so rank 1 is lowest row), New Hope climb,
    Schemer leader counts, Ambassador vote counts,
  - Bounty created blank + never overwritten,
  - site-fail leaves Ruler/New Hope block untouched,
  - empty votes leaves Schemer/Ambassador block untouched,
  - only runs for the ACTIVE season (historical blocks never touched),
  - close path uses `seasonLength` round after `'Season Ended'` (not round 1),
  - close writes before the settings flip.
- tier2: podium reads with `siteFetches === 0` && `voteReads === 0` for the
  active season when blocks exist; scrape/vote fallback when absent; Ambassador
  live codenames on podium-sourced entries; my-stats winner rule (max SCORE
  ties / Ruler single).
- `syncPlayersFromWebsite`: assert `refreshAwardsPodium` called in voting-open path.

## Rollout (deploy @41 BEFORE today's close)
1. Implement + test @41 (88 -> roughly equal, green).
2. Deploy backend @41 BEFORE the close runs today.
3. Today's `advanceLeagueWeek` close path runs `refreshAwardsPodium` -> creates 15
   S6 rows, fills Ruler/New Hope (site already final), leaves Schemer/Ambassador
   empty (no sheet votes), Bounty blank.
4. Manually fill Schemer/Ambassador/Bounty after close.
5. Commit @41, push on explicit approval. Frontend @61 unchanged.

## Ship
- Backend-only standalone changeset.
- Deploy backend @41, commit @41, push only on explicit approval.
- Frontend @61 unchanged.
