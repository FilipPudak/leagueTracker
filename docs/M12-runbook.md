# M12 Production Cutover Runbook

## Pre-Cutover Checklist

- [ ] M1-M8 Worker code committed and tested (387 tests green)
- [ ] M2.sql migration file updated with table recreations
- [ ] `handleBackfillFromMelee` passes `resync:true` to trigger
- [ ] `materializePastAwards` handler working (dryRun + real write)

## Step 1: Export D1 Backup

```bash
wrangler d1 export league-tracker --remote > backup-$(date +%Y%m%d-%H%M%S).sql
```

This is the rollback anchor. Store it safely.

## Step 2: Deploy M1-M8 Worker Code

```bash
cd backend
npx wrangler deploy
```

Verify deployment:
```bash
curl -X POST https://league-tracker.filip-pudak.workers.dev -H "Content-Type: application/json" -d '{"action":"getLeaderboardData"}'
```

## Step 3: D1 Schema Migration

Execute M2.sql:
```bash
wrangler d1 execute league-tracker --remote --file=migrations/M2.sql
```

Verify:
```bash
wrangler d1 execute league-tracker --remote --command "PRAGMA table_info(seasons)"
wrangler d1 execute league-tracker --remote --command "PRAGMA table_info(melele_tournaments)"
wrangler d1 execute league-tracker --remote --command "PRAGMA table_info(votes)"
```

## Step 4: Re-backfill S1→S7

For each season (S1 through S7), run backfill with `resync:true`:

```bash
curl -X POST https://league-tracker.filip-pudak.workers.dev \
  -H "Content-Type: application/json" \
  -d '{"action":"backfillFromMelee","adminToken":"YOUR_SECRET","seasonId":1,"resync":true,"maxTournaments":5}'
```

Repeat for seasons 2, 3, 4, 5, 6, 7.

## Step 5: Verification Gates

Run these queries after each season backfill:

### Tournament Counts

```bash
wrangler d1 execute league-tracker --remote --command \
  "SELECT season_id, COUNT(*) as count FROM melee_tournaments GROUP BY season_id ORDER BY season_id"
```

Expected: S1=12, S2=17, S3=17, S4=17, S5=12, S6=13, S7=1

### Orphan Check

```bash
wrangler d1 execute league-tracker --remote --command \
  "SELECT COUNT(*) as orphans FROM season_standings ss LEFT JOIN melee_tournaments mt ON mt.season_id = ss.season_id AND mt.round = ss.round WHERE mt.melee_id IS NULL"
```

Expected: 0

### Collision Check

```bash
wrangler d1 execute league-tracker --remote --command \
  "SELECT season_id, round, COUNT(*) as cnt FROM melee_tournaments GROUP BY season_id, round HAVING cnt > 1"
```

Expected: 0 rows

### Match Count

```bash
wrangler d1 execute league-tracker --remote --command \
  "SELECT season_id, COUNT(*) as count FROM match_results GROUP BY season_id ORDER BY season_id"
```

### S6 Ruler Podium

```bash
wrangler d1 execute league-tracker --remote --command \
  "SELECT player_id, SUM(match_points) as total_points FROM season_standings WHERE season_id = 6 AND round IN (SELECT round FROM melee_tournaments WHERE season_id = 6 AND phase = 'regular') GROUP BY player_id ORDER BY total_points DESC LIMIT 3"
```

Expected: Dennis 67 / Chris 66 / Filip 63 (player IDs TBD)

## Step 6: Materialize Past Awards (S1-S5)

### Dry Run First

```bash
curl -X POST https://league-tracker.filip-pudak.workers.dev \
  -H "Content-Type: application/json" \
  -d '{"action":"materializePastAwards","adminToken":"YOUR_SECRET","seasonId":1,"dryRun":true}'
```

Review the podiums. Repeat for seasons 2, 3, 4, 5.

### Real Write (After Approval)

```bash
curl -X POST https://league-tracker.filip-pudak.workers.dev \
  -H "Content-Type: application/json" \
  -d '{"action":"materializePastAwards","adminToken":"YOUR_SECRET","seasonId":1,"dryRun":false}'
```

Repeat for seasons 2, 3, 4, 5.

## Step 7: Verify S7 Active Season

S7 should already be active (started earlier). Verify:

```bash
wrangler d1 execute league-tracker --remote --command \
  "SELECT * FROM settings WHERE key IN ('ACTIVE_SEASON_ID', 'CURRENT_WEEK', 'SEASON_STARTED', 'VOTING_OPEN', 'SEASON_PAUSED')"
```

Expected: ACTIVE_SEASON_ID=7, CURRENT_WEEK=Week 1, SEASON_STARTED=TRUE, VOTING_OPEN=FALSE

## Step 8: Frontend Deploy (M9)

After M9 is implemented:
```bash
cd docs/app
# Update APP_VERSION to 4.0.0
git add -A && git commit -m "feat: frontend v4.0.0"
git push origin main
```

## Rollback

If anything goes wrong:

1. Restore D1 from backup:
```bash
wrangler d1 execute league-tracker --remote --file=backup-YYYYMMDD-HHMMSS.sql
```

2. Rollback Worker:
```bash
wrangler deployments rollback
```
