# CONTEXT.md — Domain Language of the SWU League Tracker

Ubiquitous language for the Stockholm Star Wars Unlimited league app. Definitions only — no
implementation. Code, docs, and tests must use these terms exactly. When a decision below looks
surprising, the rationale section says why.

---

## 1. Purpose & Authority

- The app is an **unofficial, member-run companion** to the Wednesday league. The community
  organizes on Discord; the venue is Dragon's Lair Stockholm.
- **Melee.gg is the sole source of truth** for everything that happened at the table: pairings,
  results, standings, attendance.
- `stockholm.sw-unlimited.com` (the league results site, run by Fredrik Bergqvist) is **not a
  source of truth**. Its final page ("week 12") wrongly folds championship-cut matches into the
  season tally. Its only role in this project: its published S6 week-11 table and embedded
  season config are captured **once, offline, as test fixtures** to reconcile the app's
  aggregation engine. Never scraped at runtime.
- Subjective facts exist only in the app: the **leader a player enjoyed playing** and the
  **favorite opponent** — the two weekly votes. Melee cannot know these.

## 2. People

| Term | Definition |
|---|---|
| **Player** | A roster entry with a permanent ID `P###`. IDs are never reused or merged away silently. |
| **Roster** | All player rows. Anyone seen in Melee data may be **auto-created** (`active=1`, `melee_name` set, display name = Melee `DisplayName` → `Name` → `Username` fallback chain). All roster players are shown in the link picker — a one-time opponent is still a player who deserves a link. |
| **Email claim** | Honor-based linking: player picks their name + enters an email; the email is permanently bound to that player on first claim. One email ↔ one player. Changing an email requires an admin. |
| **Device** | Browser/local-storage UUID. Sessions are per (player, device). |
| **Session** | Token minted at link. **90-day rolling TTL** from last activity. Unlink is **device-scoped**: other devices of the same player are untouched. |
| **Admin** | Holder of `ADMIN_SECRET`; performs season lifecycle, backfill, sync, leader catalog, and pause actions. |

**Fragile contract:** `players.melee_name` is *the* identity join key to all Melee data. A player
renaming on Melee, or an organizer typo, silently orphans their results. The site has even seen a
username that is literally a GUID (P022 "Sigge Maslov").

## 3. Time Model

| Term | Definition |
|---|---|
| **League Night** | Wednesday ~18:00–22:00 **Europe/Stockholm**. One night = one independent Melee tournament (its own short Swiss, ~4 rounds). |
| **Night / Round / Week** | The same number. `round N` (Melee data) ≡ `week N` (votes, attendance, `CURRENT_WEEK`). Enforced by `UNIQUE(season_id, round)` on tournaments. |
| **`CURRENT_WEEK`** | *The week currently open for voting* = the most recent completed league night. On season start it is `Week 1` before week 1 is played; the first sync run opens voting without advancing. |
| **Vote referent** | A vote for week N is about **night N as it just finished**. |
| **Voting window** | Opens at night N's sync; closes when night N+1's sync advances the week. The stored weekly deadline (Wed 17:45) is **displayed only** — a courtesy reminder before games start — and never enforced. |
| **Cron** | Fires **twice per Wednesday: 20:15 and 21:15 UTC**. Exactly one of those is 22:15 Stockholm in either DST state (summer UTC+2 / winter UTC+1). |
| **Advance gate** | Week-advance and voting-open happen only when computed Stockholm local time ≥ 22:10 **and** the `LAST_ADVANCED` marker (e.g. `S7-W3`) proves this week hasn't advanced yet. Data sync itself runs idempotently on *every* fire: late-published Melee results are picked up automatically. |
| **Paused** | `SEASON_PAUSED=TRUE`: sync continues, but no advance, no voting open/close. Toggled by `pauseCurrentSeason` / `resumeCurrentSeason`. |

**Rationale:** Cloudflare crons are UTC-only. Double-fire + deterministic local-time gate yields
"once per week, right after league night" in every DST state, and makes late data entry
self-healing. If the organizer publishes results after both fires, the week still advances
(voting opens with fallback to all players); an admin may run `syncNow` to pull results early.

## 4. Season Lifecycle

```
startNewSeason(seasonLength, topResults)
  → seasons row (id, name, length, top_results)
  → ACTIVE_SEASON_ID=<plain number>, CURRENT_WEEK="Week 1",
    VOTING_OPEN=FALSE, SEASON_STARTED=TRUE

Wednesday run for night N:
  sync night-N data (if present & published — idempotent, catches late data any later fire)
  if VOTING_OPEN=FALSE: set TRUE               (first run: open, do not advance)
  else if N+1 > length: CLOSE — see below
  else: CURRENT_WEEK="Week N+1", record LAST_ADVANCED

Close sequence (runs on the fire after the last regular week's window — usually the
championship night):
  sync that night's events (including the cut!) → compute & materialize awards →
  VOTING_OPEN=FALSE, SEASON_STARTED=FALSE, CURRENT_WEEK="Season Ended"
```

## 5. Season Configuration

Per-season values live on the `seasons` row (`length`, `top_results`), set at `startNewSeason`.

| Season | Length (regular nights) | Top results | Source |
|---|---|---|---|
| S1 | 10 | 7 *(assumption — validate against the offline fixture at materialization)* | inferred |
| S2 | 15 | 10 | organizer's rule |
| S3 | 15 | 10 | organizer's rule |
| S4 | 15 | 10 | organizer's rule |
| S5 | 11 | 7 | organizer's rule (corrected from 10) |
| S6 | 11 | 7 | engine reconciliation: derived week-11 table reproduces the seeded Ruler podium (67/66/63) |
| S7 | 11 | 7 | organizer confirmed |

## 6. Events & Phases

A league-season's Melee tournaments are classified by `phase`:

| Phase | Name pattern | Examples | Feeds |
|---|---|---|---|
| **regular** | date `D/M` or `DD/MM` in the name | "SWU Wednesday league season 6 15/7 (week 8)" | season table, attendance, voting/opponent filter, Ruler, New Hope, Bounty Hunter |
| **cut** | Top 8 / Top 4 / Playoff / Championship | "SWU Wednesday league season 6 TOP 4" | **Galactic Champion** only |
| **side** | Best of the Rest / finale | "SWU Wednesday league season 6 Best of the Rest" | nothing official; stored, labeled, browsable |

- Excluded entirely: `prerelease`, `draft`, `clone`, `budget draft`, non-league names.
- Season 1 events carry no "season N" in their name → they belong to **season 1** by definition.
- **Round assignment:** regular rounds follow the explicit `(week N)` label when present;
  otherwise date order (labels trusted; mismatch = warning). Same-day ordering: cut before side,
  then melee_id — deterministic.
- Championship events occupy rounds *after* the last regular week; every consumer of
  "final standings" must filter `phase='regular'`.

**Fragile contract:** tournament names are hand-typed by the organizer (leading tabs have
occurred; a week label goes missing sometimes; an event with no date exists and is correctly
ignored).

## 7. Records

| Term | Definition |
|---|---|
| **Night result** | A player's final standing in one regular tournament: match W/D/L (a "match" = one BO3 set), night points = 3W + D, rank. **A bye counts as a win** — this is how the league's official regular standings treat byes. |
| **Season table** | Derived, not stored: for each player, the **sum of their best `top_results` night results** (by night points; a tie at the boundary keeps the earlier night), then Played/Won/Drawn/Lost totals, Points = 3W + D. Ranks: points desc → undefeated-nights count → sum of night ranks (lower better) → **shared rank** if still tied. |
| **Match result** | One BO3 set between two players: winner = higher `GameWins`; equal game wins ⇒ **draw** (`winner_id` NULL, result string kept). Byes are recorded (`is_bye=1`) but are never a "win against a person". |
| **Attendance** | A player **attended week N** iff they appear in week N's regular standings. Regular nights only — cut/side attendance is not tracked. |

## 8. Voting

- One **vote** per player per week, in a single merged table (voter column exists; see
  anonymity). Both fields are **mandatory**: leader played + favorite opponent.
- **Editable until close:** `updateVote` replaces both choices, only while `VOTING_OPEN` and only
  for `CURRENT_WEEK`. Re-checks: self-vote prohibited, vote count re-validated.
- **Anonymity of the favorite-opponent choice is a display and query invariant, not a physical
  one:** no feature, endpoint, or UI may ever render the voter→opponent mapping; only aggregate
  tallies exist. (A previous "de-identified at rest" design was abandoned: it was already
  breakable via synchronized insert timestamps, and it made vote editing impossible.)
- Voting without attending is allowed (rain-outs, arriving late to vote after the game): it earns
  raffle tickets but does not move compliance.

## 9. Awards (six)

Materialized podiums written at season close into the `awards` table. Every tied winner is its
own row; a podium may exceed three entries (tie-aware); standard competition ranking (1,1,3,4).

| Award | Definition | Tie-break |
|---|---|---|
| **Galactic Ruler** | #1 on the season table after the final **regular** week | points → undefeated-night count → night-rank sum → shared |
| **Galactic Champion** | Rank 1 of the chronologically last **cut** event of the season (the bracket winner — may differ from Ruler; S6: Champion=Filip, Ruler=Dennis) | impossible (bracket rank is strict); if a season has no cut data, no row |
| **Galactic Schemer** | Most distinct leaders played (from votes) | share podium |
| **Galactic Ambassador** | Most favorite-opponent votes received | share podium |
| **A New Hope** | Biggest rank climb on the rolling season table from end-of-round ⌊length/2⌋ to final regular round; must appear in **both** snapshots | ties share the victory |
| **Bounty Hunter** | Regular-season non-bye match wins against players who placed top-4 in the **previous** season's final regular season table | share podium; **none in S1** (no prior season) |

**Reveal gating (display rules):** Ambassador names are **callsigns** while voting is live
("Gold Leader", …); Bounty Hunter is hidden while voting is live; both resolve at close.

**Provenance by season:**

| Seasons | How awards exist |
|---|---|
| S1–S5 | One-time **materialization** after the data rebuild (Ruler, New Hope, Champion, Bounty Hunter; Schemer/Ambassador absent — no historical votes). Never recomputed afterwards. |
| S6 | **Manual seed, sacred.** Its awards predate live voting; never overwrite. (Cross-check only: its Ruler scores match the derived S6 season table.) |
| S7+ | Native: computed by the close sequence from votes + Melee data. |

## 10. Gamification (private motivation layer)

| Term | Definition |
|---|---|
| **Voting Milestone** | A personal **progress bar 0 → 4 votes** for the current season (resets each season). Filling it earns a small offline reward chosen by the organizer. It is a completion bar, **not** a points system, and **not** the raffle. |
| **Raffle Tickets** | A separate, plainly displayed count: **1 ticket per vote submitted**, accumulating within the season, **no bonuses, no gates**. The end-of-season raffle is drawn **manually, off-system**, using these stored per-player counts. The UI states next to the count that tickets are used in the season-end raffle. |
| **Compliance** | Weeks voted ÷ weeks attended, this season. Private (own My Stats only). |
| **Streak** | Consecutive **attended** weeks that were also voted; a missed *attendance* does not break the streak (only attended weeks form the sequence). |

**Hard rule (public vs private):** individual participation metrics — tickets, compliance,
streaks, badges — appear **only in that player's own My Stats**. Public surfaces (Vote tab,
Leaderboard/Awards) show **aggregates only** ("X of Y voters attended last night have voted"),
never per-player rankings.

## 11. Public Displays

- **Weekly participation card:** X voted ÷ Y where Y = players **who attended the current
  voting week's night** (not the whole roster — 77 historical names make "3 of 77" read like
  failure). Denominator 0 → hide the card.
- **Season participation stat:** denominators are attendance-based (players with ≥1 attended
  night that season).
- **Standings tab:** the derived **season table** (default, as-of the latest regular round, with
  an as-of round picker) plus per-night results; championship/side events appear as clearly
  labeled rounds. Mirrors the league site's information architecture (cumulative table + round
  tabs), powered purely by Melee-derived data.
- The site's ★ = count of cut wins (Champion count) — the app may render the same later.

## 12. Settings Glossary (D1 `settings`)

| Key | Producer | Consumers / meaning |
|---|---|---|
| `ACTIVE_SEASON_ID` | startNewSeason | plain number string (legacy `'S6'` tolerated everywhere via parse) |
| `CURRENT_WEEK` | startNewSeason, weekly run | `"Week N"` / `"Season Ended"` — the week open for voting |
| `VOTING_OPEN` | weekly run (first + close) | gate for submit/update vote; drives Ambassador/BH reveal |
| `SEASON_STARTED` | startNewSeason, close | gates the weekly run entirely |
| `SEASON_PAUSED` | pause/resume actions | sync yes, move no |
| `LAST_ADVANCED` | weekly run | exactly-once advance marker per week |
| `TIMEZONE` | manual | display only (Europe/Stockholm) |
| `WEEKLY_DEADLINE_DAY` / `_TIME` | manual | **displayed only** ("closes Wed 17:45"), never enforced |
| ~~`SEASON_LENGTH`~~ | — | **retired** → `seasons.length` |
| ~~`AUTO_ADVANCE_WEEK`~~ | — | **retired** → replaced by `SEASON_PAUSED` |

## 13. Invariants & Known Landmines

1. Round ≡ week ≡ voting window — guarded by `UNIQUE(season_id, round)`.
2. Every `MAX(round)` / "final standings" query filters `phase='regular'`.
3. A night is "fully synced" only when **both** its standings and its match rows exist; an empty
   tournament (created but unplayed/unpublished) may be re-fetched.
4. Sync and backfill share one player-lookup/creation path; unknown Melee names are
   auto-created (both paths, identically).
5. Session timestamps are ISO-8601 UTC with `Z` everywhere (SQL `datetime('now')` and
   date-only strings are legacy formats to be normalized).
6. Season IDs parse via digit-extraction (`'S6'`→6); no raw `Number()` on season strings.
7. Melee standings/match endpoints return max 25 rows/page — all reads paginate until
   `HasMore=false`.
8. Match rows have **no numeric ID** — the UUID `Guid` is the stable key (stored in
   `melee_match_id TEXT`).
9. Vote rows are never deleted by opponent-matching heuristics; the merged votes table makes
   edit-by-(voter, week) trivial.
10. Rate limiting is best-effort per Worker isolate (documented, not a security guarantee).
11. `melee_guid` column exists and is unpopulated — reserved; do not depend on it.
