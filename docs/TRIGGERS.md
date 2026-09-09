# Triggers & Lifecycle

The backend uses a Cloudflare Worker with dual-cron triggers for DST-safe weekly automation.

## Cron Schedule

```toml
[triggers]
crons = ["15 20 * * 3", "15 21 * * 3"]
```

Two fires per Wednesday (20:15 and 21:15 UTC). Exactly one is 22:15 Stockholm in either DST state (summer UTC+2 / winter UTC+1).

## `syncFromMelee`

**What it does:** The main weekly lifecycle function. Runs on every cron fire.

1. **Gate:** Checks `SEASON_STARTED` — skips if FALSE
2. **Sync:** Fetches tournaments from Melee.gg API, inserts new ones, syncs standings and matches for all unsynced rounds
3. **Attendance:** Rebuilt from regular standings
4. **Awards:** Recomputes Schemer, Ambassador, Ruler, Champion, Bounty Hunter, A New Hope
5. **Advance gate:** `shouldAdvance(isoNow, marker)` checks:
   - Stockholm local time ≥ 22:10
   - `LAST_ADVANCED` marker ≠ today's date (YYYY-MM-DD)
6. **First run of season:** Sets `VOTING_OPEN=TRUE`, sets `LAST_ADVANCED=today`
7. **Subsequent runs:** Advances `CURRENT_WEEK` to next week, sets `LAST_ADVANCED=today`
8. **Season close:** When next week > `seasons.length` → syncs cut event, materializes all awards, sets `VOTING_OPEN=FALSE`, `SEASON_STARTED=FALSE`, `CURRENT_WEEK='Season Ended'`
9. **Paused:** If `SEASON_PAUSED=TRUE` → syncs data only, skips advance/open/close

**Late data handling:** Data sync runs on every fire. If Melee publishes results after both fires, the next week's sync picks them up automatically.

## Admin Actions

All require `adminToken` matching `ADMIN_SECRET` env var.

| Action | What it does |
|--------|--------------|
| `syncNow` | Runs sync immediately, bypasses time gate, honors LAST_ADVANCED marker |
| `pauseCurrentSeason` | Sets `SEASON_PAUSED=TRUE` — sync continues, no advance |
| `resumeCurrentSeason` | Sets `SEASON_PAUSED=FALSE` |
| `startNewSeason` | Creates new season row, sets `SEASON_STARTED=TRUE`, `CURRENT_WEEK='Week 1'`, `VOTING_OPEN=FALSE` |
| `materializePastAwards` | Computes awards for S1-S5 only; `dryRun` prints podiums first |

## Settings

| Key | Purpose | Set by |
|-----|---------|--------|
| `ACTIVE_SEASON_ID` | Current season number | `startNewSeason` |
| `CURRENT_WEEK` | `'Week N'` or `'Season Ended'` | `startNewSeason`, weekly advance |
| `VOTING_OPEN` | `'TRUE'`/`'FALSE'` | First fire opens, close sets FALSE |
| `SEASON_STARTED` | Gates the sync entirely | `startNewSeason`, close |
| `SEASON_PAUSED` | Sync yes, move no | `pauseCurrentSeason`/`resumeCurrentSeason` |
| `LAST_ADVANCED` | Date marker (YYYY-MM-DD) — prevents double-advance | Weekly advance |
| `TIMEZONE` | Display only (`Europe/Stockholm`) | Manual |
| `WEEKLY_DEADLINE_DAY`/`_TIME` | Display only (`Wednesday`/`17:45`) | Manual |

## Manual Invocation

```bash
# Trigger sync immediately
curl -X POST https://league-tracker.filip-pudak.workers.dev \
  -H "Content-Type: application/json" \
  -d '{"action":"syncNow","adminToken":"YOUR_SECRET"}'

# Start new season
curl -X POST https://league-tracker.filip-pudak.workers.dev \
  -H "Content-Type: application/json" \
  -d '{"action":"startNewSeason","adminToken":"YOUR_SECRET"}'

# Pause season
curl -X POST https://league-tracker.filip-pudak.workers.dev \
  -H "Content-Type: application/json" \
  -d '{"action":"pauseCurrentSeason","adminToken":"YOUR_SECRET"}'
```
