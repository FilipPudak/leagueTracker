# Triggers & Lifecycle Functions

The following backend functions run as Cloudflare Worker cron triggers (scheduled handlers)
or via manual invocation. They are **not** exposed through the public API.

## `syncPlayers`

- **Schedule:** `30 8 * * 1` — every Monday at 08:30 UTC.
- **What it does:** Fetches the SWU league site, adds new players and updates
  display names for existing melee handles, then records attendance from the current
  round's standings. Silently skips on site outage or non-200 response.
- **Handler:** `backend/src/triggers/syncPlayers.js`

## `advanceWeek`

- **Schedule:** `0 9 * * 1` — every Monday at 09:00 UTC (30 minutes after `syncPlayers`).
- **What it does:** Increments `CURRENT_WEEK` in the D1 `settings` table and reopens voting.
  At the final week (per `SEASON_LENGTH`), closes voting, materializes the
  15-row award podium, and sets `CURRENT_WEEK` to `Season Ended`.
- **Prerequisite:** Voting must be open (`VOTING_OPEN = TRUE`).
- **Handler:** `backend/src/triggers/advanceWeek.js`

## `startNewSeason`

- **Schedule:** Manual (run after confirming the previous season's
  awards and any manual Bounty Hunter fill).
- **What it does:** Appends a new row to the D1 `seasons` table, sets `ACTIVE_SEASON_ID` to the
  next number, resets `CURRENT_WEEK` to `Week 1`, and opens voting.
- **Note:** No Worker handler exists yet. This is a manual D1 operation until implemented.

## Recommended trigger order (weekly)

1. `syncPlayers` — roster refresh + attendance recording.
2. `advanceWeek` — advance the week / close the season.

Cron schedules are configured in `backend/wrangler.toml`:

```toml
[triggers]
crons = ["30 8 * * 1", "0 9 * * 1"]
```

Manual invocation:

```sh
# Using wrangler
cd backend && npx wrangler cron trigger "syncPlayers"
cd backend && npx wrangler cron trigger "advanceWeek"

# Or via the Worker's scheduled handler
curl -X POST https://league-tracker.filip-pudak.workers.dev \
  -H "Content-Type: application/json" \
  -d '{"action":"syncPlayers"}'
```
