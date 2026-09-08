# PRD — League Tracker V2: Correct Data Engine + Lifecycle + Standings UX

**Date:** 2026-09-08 · **Status:** Approved decisions; awaiting execution
**Vocabulary:** every term below is defined in `CONTEXT.md` — this PRD never redefines, only references.
**History:** `PLAN.md` records the Melee API field-level findings (wrong assumptions vs correct facts).

---

## 1. Problem Statement

The Melee.gg integration shipped data-corruption and design defects discovered during a
production-readiness review and a full-domain grilling session:

1. **Silent data loss:** standings/match endpoints paginate at 25 rows; we read one page.
2. **Corrupted production data:** ghost orphan standings (S1 tournaments filed under S2–S5, S7),
   offset round numbers (real tournaments at rounds 11–24), and round collisions (two tournaments
   per (season, round)) — caused by a season-assignment bug plus non-deterministic round
   numbering that recomputed differently on every run.
3. **Broken lifecycle math:** weekly sync counts specials in `seasonLength`; a season can end
   prematurely (imminent for S7: 23 Sep) or 2 weeks late; championship rounds pollute every
   `MAX(round)` "final standings" query.
4. **Missing domain concepts:** the season table (best-X nights, 3W+D, byes-as-wins) exists only
   on an external site the league has outgrown; the app has 7 seasons of data it never shows;
   Galactic Champion and a computed Bounty Hunter don't exist.
5. **Model contradictions:** vote-editing is required but the de-identified opponent table makes
   it impossible; `player_id NOT NULL` standings silently drop unknown players; session
   timestamps mix three formats.

## 2. Success Criteria

- [ ] S6 derived season table (best 7 of rounds 1–11) reproduces the seeded Ruler podium
      (Dennis 67 / Chris 66 / Filip 63) and full P/W/D/L rows — golden-file test, offline fixture.
- [ ] Zero orphan standings/match rows (every (season, round) joins to a tournament).
- [ ] Zero (season, round) collisions, enforced by `UNIQUE` index.
- [ ] Per-season tournament rows: S1=12, S2=17, S3=17, S4=17, S5=12, S6=13, S7=1 (+ as created).
- [ ] Stored match rows equal each tournament's API `RecordsTotal` (sampled verification).
- [ ] S7 season cannot end before `length` (11); advance fires exactly once per week in both
      DST states; `syncNow` backfills late results without touching week state.
- [ ] Players can vote (both fields) and edit until close; tickets/compliance/streaks display
      per CONTEXT §10 with attendance-based denominators.
- [ ] 4 tabs shipped: Vote | Standings | Awards | My Stats; standings browsable per as-of round
      and per night, with cut/side events labeled.
- [ ] S1–S5 awards materialized once (Ruler, New Hope, Champion, Bounty Hunter); S6 rows
      byte-identical before/after.
- [ ] Test suite ≥ 304, all green; no external test deps.
- [ ] `TRIGGERS.md`, `DATABASE.md`, `README.md`, `SECURITY.md`, `AGENTS.md` describe reality.

## 3. Workstreams

### M0 — Interim season-end guard (URGENT: deploy approval before Mon 21 Sep)

**Why:** currently deployed code ends a season when `nextWeek > weekMap.size` (tournaments that
exist on Melee *now*). S7 has 1–2 tournaments created; run 3 (23 Sep) could close S7 with 8
weeks left. M5 is the real fix but cannot be safely rushed before S7 week 2.

**Change:** in `syncFromMelee`, `seasonLength = Math.max(weekMap.size, parseWeek(settings.SEASON_LENGTH) || 11)`.
One guard line + 1 regression test. Then `startNewSeason` for S7 (with user's explicit trigger).

**Exit criteria:** S7 voting live week 1; season cannot close before week 11.
**Risk:** none beyond current deploy process. Removed by M5.

### M1 — Shared Melee league layer + client pagination

**Why:** F7 (4 duplicated blocks between triggers), F1 (25-row truncation), F6 (null-season
divergence).

**Changes:**
- New `backend/src/lib/meleeLeague.js`: `LEAGUE_REGEX`, `EXCLUDED_KEYWORDS`, `classifyPhase(name)`
  → `regular|cut|side`, `isLeagueTournament`, `extractSeasonAndRound` (null → season 1),
  `resolveRound` (explicit `(week N)` label trusted, positional fallback, warn on mismatch),
  `sortRoundsDeterministic` (date → cut → side → melee_id), `fetchLeagueTournaments(client, {
  targetSeason })` (paginated, deduped), `buildWeekMap`, `createPlayerFinder(DB)` (the verified
  check→DB-lookup→create factory; cached-entry staleness guard).
- `MeleeClient.getStandings(id)` / `getMatches(id)` loop pages until `HasMore=false`, honoring
  the existing 429/5xx backoff.
- Both triggers import the module; delete private copies.

**AC:** no regex/keyword literals outside `meleeLeague.js`; pagination integration test against
recorded 2-page real response shapes.

### M2 — Schema migration (single D1 maintenance window, paired with M12 wipe)

**Changes (schema.sql + prod):**
- Recreate `match_results`: `melee_match_id TEXT` (prod currently INTEGER), plus `UNIQUE(
  season_id, round, melee_match_id)`.
- `melee_tournaments`: recreate with `phase TEXT NOT NULL DEFAULT 'regular'` and
  **`UNIQUE(season_id, round)`** — organizer clone events on one round are rejected with a logged
  warning (CONTEXT §13.4).
- `seasons`: add `length INTEGER NOT NULL DEFAULT 11`, `top_results INTEGER NOT NULL DEFAULT 7`.
- New `votes` table (M7 merge): `id, timestamp, updated_at, season_id, week, player_id,
  leader_id NOT NULL, opponent_id NOT NULL, UNIQUE(season_id, week, player_id)`; drop the empty
  `leader_votes`/`opponent_votes`.
- Backfill `seasons.length/top_results` per CONTEXT §5 table.

### M3 — Backfill engine v2

**Changes to `backfillFromMelee`:**
- Consume M1 module; tag `phase` on every tournament insert.
- **Resync mode:** `resync:true` wipes the target season's standings/matches/attendance rows
  first; skip-a-round only when that round has **both** standings and matches (a fully empty
  tournament like S6 5/8 pre-publish re-fetches — bounded by batch size).
- Attendance rebuilt from regular standings during backfill (CONTEXT §7).
- Auto-create unknown players (shared factory) with active=1.
- Default `maxTournaments` lowered to **5** (subrequest budget: 5 nights ≈ 15–20 API+D1 heavy
  ops; 15 was the pre-pagination assumption).

### M4 — Season-table engine + standings endpoint (the core domain logic)

**Scoring:** Win = 3 points, Draw = 1 point, Loss = 0 points. Night points = 3W + D.

**New `backend/src/lib/seasonTable.js`** (pure functions, no I/O — ownership: fully unit-testable):
- `nightPoints(s)` = 3·wins + draws.
- `seasonTableFor(nights, topResults)`: best-X selection by night points (boundary tie → earlier
  night), aggregate P/W/D/L, points, rank chain per CONTEXT §7 (points → undefeated nights →
  night-rank sum → shared).

**New action `getStandingsData(body, env)`** (no token): returns for a season (+optional
`asOfRound`): the cumulative season table; and per-round night results incl. labeled cut/side
events. Regular-only by default; `phase` included per row for labeling.

**AC (gate for everything downstream):** golden test with
`backend/test/fixtures/site-s6-week11.json` — derived table must equal the captured site fixture
(rank order + points + P/W/D/L) for all 30 players. S1–S5 configs validated against their site
pages **offline at fixture-capture time, this session** — never at runtime.

### M5 — Lifecycle sync rewrite

**Rewrite `syncFromMelee`:**
- Gate: `SEASON_STARTED`; **if `SEASON_PAUSED=TRUE` → sync data only, return before
  advance/open/close**.
- Targeted sync of the round matching `CURRENT_WEEK` (via `resolveRound`), auto-create players,
  attendance (regular only), completeness rule from M3.
- **Dual-cron local gate:** `crons = ["15 20 * * 3", "15 21 * * 3"]` UTC. Pure exported helper
  `shouldAdvance(isoNow, marker, weekKey)` = (Stockholm local ≥ 22:10 via
  `Intl.DateTimeFormat` with `timeZone: 'Europe/Stockholm'`) AND `settings.LAST_ADVANCED ≠
  weekKey`. Data sync runs on every fire; week advance/open/close only through the gate, which
  then writes `LAST_ADVANCED`.
- Close sequence: when `nextWeek > seasons.length` → sync tonight's cut event **first**, then
  materialize awards (Ruler, Schemer, Ambassador, New Hope, Bounty Hunter, Champion), flip
  `VOTING_OPEN`/`SEASON_STARTED` FALSE, `CURRENT_WEEK='Season Ended'`.
- Retire `SEASON_LENGTH`/`AUTO_ADVANCE_WEEK` reads; `seasons.length/top_results` from M2 replace them.

**AC:** simulated fires at 20:15 & 21:15 UTC on summer *and* winter dates advance exactly once;
late-Melee-data test (night N absent → advance proceeds; results arrive Thu → next fire syncs
round N without moving `CURRENT_WEEK`).

### M6 — Awards v2

- `lib/awards.js`: add `computeChampion(DB, season)` (rank 1 of chronologically last `cut`
  tournament) and `computeBountyHunter(DB, season)` (current-season non-bye wins vs previous
  season's top-4 from the final regular season table; returns `[]` for S1 / no-prev-season).
- Ruler uses **M4 season-table semantics** (best-X nights, `computeSeasonTable`).
- New Hope uses **raw accumulated standings** at round ⌊L/2⌋ vs **derived season table** at final regular round.
- Bounty Hunter uses **raw match data** (non-bye wins against previous season's top-4).
- **`materializePastAwards(seasonId, {dryRun})`** admin action for S1–S5 only (hard refusal for
  ≥6): computes Ruler, New Hope, Champion, Bounty Hunter, writes via `writePodiumBlock`,
  skips Schemer/Ambassador (no historical votes). `dryRun` prints the podiums first.
- Close-time (M5) computes all six for S7+.

**AC:** dry-run outputs for S1–S5 reviewed by user before any real write; S6/awards table
checksummed before/after to prove untouched.

### M7 — Votes merge refactor + `updateVote` + identity hygiene

- **Votes merge:** replace `leader_votes`/`opponent_votes` with the single `votes` row per
  CONTEXT §8 (tables are empty — zero migration). Rewrite ~10 touchpoints: `submitVote`,
  `updateVote` (new: token-gated, `VOTING_OPEN`-gated, `CURRENT_WEEK`-only, full replacement of
  both fields, self-vote re-check), `hasPlayerVotedThisWeek`, `getCompliance`, `getStreaks`,
  `getRaffleTickets`, `getWeeklyParticipation`, `getSeasonParticipation`, `computeSchemer`,
  `computeAmbassador`, `getMostPlayedLeaders`, `linkAccount`/`getAppData` alreadyVoted lookups,
  `getMySeasonStats` leaders-played.
- Server-side: opponent becomes mandatory (was silently optional).
- **Privacy guard:** add a lint-style test asserting no query joins `votes` into any response
  containing `opponent_id` alongside the voter identity (display invariant from CONTEXT §8).
- **Hygiene:** session timestamps unified to `new Date().toISOString()` on every write (fix the
  `datetime('now')`/date-only mix); `parseSeasonId` everywhere (kill `Number('S6')→NaN` in
  `linkAccount`, `parseWeek` misuse in `submitVote`); delete `collapseDeviceSessions` (dead code
  — verify grep, then remove); `getStandingsData` public.
- **Attendance-based denominators** (CONTEXT §11): weekly card Y = attended current round
  (0 → hide card); season stat denominator = players with ≥1 attended night.
- Stats payload gains `milestone: {votes, target: 4, complete}` + `raffleNote` — data only, copy
  lives in M9.

### M8 — Admin surface

Actions (all `ADMIN_SECRET`-gated via the same pattern as `handleBackfillFromMelee`):
`syncNow` (run weekly sync body immediately, gate-bypassing, marker-honoring),
`pauseCurrentSeason`/`resumeCurrentSeason` (`SEASON_PAUSED`),
`addLeaders([{name,set}...])` (dedupe, P-prefix-free ids as today), `setLeadersActive` (bulk
0/1), `removeLeaders` (delete only if never referenced by `votes`, else refuse with a named
list), `materializePastAwards` (M6). Router registration + `wrangler` invocation snippets in docs.

### M9 — Frontend (`docs/app/`, version 4.0.0)

- **4 tabs** per approved structure: Vote | **Standings** (new) | Awards (today's leaderboard
  panels, + Galactic Champion podium) | My Stats.
- **Standings view:** season picker + as-of round picker (default latest regular); cumulative
  table (rank, name, Played/W/D/L, Points, medal styling for podium range); "Round results"
  section showing per-night standings; cut rounds labeled "Championship Cut", side rounds
  labeled "Side Event".
- **Search picker** on link (filter on keystroke over the full roster — all players shown).
- **Vote flow:** both selects mandatory client-side; "Change vote" button on the already-voted
  card while `votingOpen` → prefilled form → `updateVote`.
- **My Stats:** milestone progress bar (votes/4, full state + copy "4 votes earns you a prize —
  ask the organizer") **separate from** "Raffle tickets: N — every vote is a ticket for the
  season-end raffle draw".
- **Deadline copy** rendered from settings ("Voting closes Wed 17:45 before games").
- Fix "Season Ended → Week 1" subtitle bug.

### M10 — Tests (runs alongside every M, not after)

- Unit: `meleeLeague` (phase classification incl. 'finale'/'Best of the Rest' edge names,
  round resolution + mismatch warning, deterministic sort, player factory branches: cache-hit,
  stale-cache, melee_name-hit, create), pagination loop (multi-page + `HasMore=false` + 429
  mid-loop), `seasonTable` (best-X boundary tie keeps earlier night; byes; tie chain; shared
  ranks; <X nights player), lifecycle pure helpers (`shouldAdvance` both DST dates; close
  ordering), `updateVote` matrix (closed → 403, wrong week → 403, self-vote → 400, success),
  admin actions (auth, leader FK-safe delete), attendance denominators (0 → hidden shape),
  privacy guard test (M7).
- Integration: M4 golden fixture reconciliation; backfill resync against multi-page mock;
  full S6 re-derivation from rebuilt mock rows.
- Fixtures: `seasons` rows gain `length/top_results`; mock-db patterns for new SQL; every
  existing test that asserted "TOP 8 excluded" semantics updated to `phase='cut'` assertions.
- Floor: ≥304 passing, 0 failing.

### M11 — Docs

- Rewrite `docs/TRIGGERS.md` (dual cron + gate + pause + close sequence + syncNow),
  `docs/DATABASE.md` (votes table, phase, seasons config, awards v2 definitions, attendance
  semantics), `README.md` (Melee source of truth, 4 tabs, current test count),
  `docs/SECURITY.md` (votes merge → privacy-by-display invariant stated honestly; per-isolate
  rate limiter caveat; session TTL).
- Update `AGENTS.md`: 6 awards, votes-table schema, new lifecycle, commands unchanged, test count.
- `PLAN.md`: add header pointer "superseded by CONTEXT.md + PRD.md; retained as API-findings log".

### M12 — Production cutover runbook (every step individually approved; order enforced)

1. `wrangler d1 export league-tracker --remote` → timestamped local backup file (rollback anchor).
2. Deploy M1–M8 Worker code (version-tagged).
3. D1 maintenance window: execute M2 schema (recreate 4 tables + seasons columns + indexes).
   Zero dependency on stale data.
4. Re-backfill S1→S7 (`resync:true`, `maxTournaments=5`, loop until each season reports no new
   rows; cut/side events included with phase).
5. Attendance rebuilt from regular standings (part of M3 runs).
6. **Verification gates (all must pass before step 7 proceeds):**
   - tournament counts per CONTEXT/§2 success list; `LEFT JOIN` orphan check = 0 rows;
     collision check (`GROUP BY season,round HAVING count>1`) = 0 rows;
   - per-tournament match totals vs API `RecordsTotal` (scripted sample of 10);
   - derived S6 best-7 table == seeded award numbers (67/66/63) and == golden fixture;
   - S1 `top_results=7` assumption: compare derived S1 table to captured fixture; **divergence
     ⇒ stop, escalate to user, adjust S1 config, re-run M4 gate**.
7. `materializePastAwards` S1–S5: dry-run output posted for user review → real write on
   approval. Spot-check P022 (GUID melee_name) + duplicate-name scan.
8. `startNewSeason` S7 `{length:11, topResults:7}` (or M0 guard + interim start if this happens
   before the cutover). Verify the coming Wednesday's dual-cron fires: data synced on first
   usable fire, `LAST_ADVANCED` written exactly once.
9. Frontend deploy (GitHub Pages) + hard-refresh check, APP_VERSION 4.0.0.

**Rollback:** D1 re-import from step-1 export; `wrangler deployments rollback` to tagged version.

## 4. Ordering & Dependencies

```
M0 (urgent, independent, temporary)
M1 ─┬─ M3 ─┐
    ├─ M5  ├──► M12 cutover ──► M6 past-awards materialization (post-rebuild data)
M2 ─┘  M4 ─┘
M7 ──► (needs M2 votes table)   M8 ──► (needs M5/M6 internals)
M9 ──► (needs M4 endpoint + M7 payloads)
M10 ─► continuously; M11 ─► at the end
```

## 5. Non-Goals (scope guard)

Decklists · Discord OAuth · head-to-head explorer · match-level browsing beyond night results ·
mid-season public vote tallies · any runtime dependency on stockholm.sw-unlimited.com ·
changing the 6 award names without a CONTEXT.md edit first.

## 6. Approval Gates (hard rules from AGENTS.md)

No `git commit`, `git push`, `wrangler deploy`, or **any D1 write** (`--remote` execute) happens
without an explicit per-action approval in the moment. `--remote` read queries are allowed.
M12 steps 3–8 are individually gated; backups precede every destructive step.

## 7. Product Readiness Reviews

After each milestone completes, conduct a **product readiness review** before moving on.
Present the following to the user for approval:

1. **What changed** — files modified/added, function signatures, schema changes.
2. **Test results** — total count, pass/fail, new tests added for this milestone.
3. **Behavioral verification** — does the implementation match the PRD acceptance criteria?
4. **Risks & tradeoffs** — anything deferred, edge cases not covered, known limitations.
5. **Ready to commit?** — explicit go/no-go before staging changes.

This gate applies to every M0–M12 milestone. No milestone is "done" until the review
is presented and the user approves.

### M13 — Deferred work cleanup

Items deferred from M5–M7 that must be completed before production use:

- **`updateVote` handler** (M7): token-gated, `VOTING_OPEN`-gated, `CURRENT_WEEK`-only, full
  replacement of both fields, self-vote re-check.
- **`materializePastAwards`** (M6): admin action for S1–S5 only (hard refusal for ≥6); computes
  Ruler, New Hope, Champion, Bounty Hunter; `dryRun` prints podiums first; real write on approval.
- **Privacy guard test** (M7): lint-style test asserting no query joins `votes` into any response
  containing `opponent_id` alongside the voter identity.
- **Opponent mandatory enforcement** (M7): server-side validation that `opponent_id` is provided
  in `submitVote` and `updateVote`.
- **Attendance-based denominators** (M7/CONTEXT §11): weekly card Y = players who attended the
  current round (not active players); season stat denominator = players with ≥1 attended night.
- **Targeted sync of CURRENT_WEEK** (M5): revisit approach — sync only the round matching
  `CURRENT_WEEK` instead of all unsynced rounds.
