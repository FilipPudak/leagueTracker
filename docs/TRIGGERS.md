# Triggers & Lifecycle Functions

The following backend functions run only via time-driven Apps Script triggers or
manual invocation from the script editor. They are **not** exposed through the
`/exec` public API.

## `advanceLeagueWeek`

- **Suggested schedule:** Weekly, e.g. every Monday at 09:00 Europe/Berlin.
- **What it does:** Increments `CURRENT_WEEK` in Settings and reopens voting.
  At the final week (per `SEASON_LENGTH`), closes voting, materializes the
  15-row award podium, and sets `CURRENT_WEEK` to `Season Ended`.
- **Prerequisite:** Voting must be open (`VOTING_OPEN = TRUE`).

## `startNewSeason`

- **Suggested schedule:** Manual (run after confirming the previous season's
  awards and any manual Bounty Hunter fill).
- **What it does:** Appends a new row to Seasons, sets `ACTIVE_SEASON_ID` to the
  next number, resets `CURRENT_WEEK` to `Week 1`, and opens voting.

## `syncPlayersFromWebsite`

- **Suggested schedule:** Weekly, e.g. every Monday at 08:30 Europe/Berlin (before
  `advanceLeagueWeek`).
- **What it does:** Fetches the SWU league site, adds new players and updates
  display names for existing melee handles, then refreshes the active season's
  award podium. Silently skips on site outage or non-200 response.

## Recommended trigger order (weekly)

1. `syncPlayersFromWebsite` — roster refresh.
2. `advanceLeagueWeek` — advance the week / close the season.
