# Architecture

System overview, data relationships, and the sync lifecycle. For domain definitions,
see [`CONTEXT.md`](../CONTEXT.md). For the D1 schema reference, see
[`DATABASE.md`](DATABASE.md).

## System components

```mermaid
flowchart LR
    subgraph Client
        Browser["Browser<br/>(GitHub Pages)"]
    end

    subgraph Backend
        Worker["Cloudflare Worker<br/>(API + cron)"]
    end

    subgraph Data
        D1[("Cloudflare D1<br/>(SQLite)")]
    end

    subgraph External
        Melee["Melee.gg API"]
        Cron["Cloudflare Cron"]
    end

    Browser -- "POST / (action)" --> Worker
    Worker -- "D1 queries" --> D1
    Worker -- "fetch tournaments<br/>standings, matches" --> Melee
    Cron -- "WED fires + THU retry<br/>+ 2h probe" --> Worker
```

- **Frontend** (`docs/app/`) — static HTML/JS on GitHub Pages. No build step. Calls the
  Worker directly with `fetch`.
- **Worker** (`backend/src/`) — single entry point. Routes POST requests to 20 action
  handlers. Runs the sync lifecycle on cron fires.
- **D1** — 11 tables, 9 indexes. Schema in `backend/schema.sql`.
- **Melee.gg** — external source of truth for tournament results. See
  [`MELEE.md`](MELEE.md) for API notes.

## Request flow

```mermaid
sequenceDiagram
    participant F as Frontend
    participant W as Worker
    participant D as D1

    F->>W: POST { action, token, deviceId, ... }
    W->>W: CORS check, rate limit, JSON parse
    W->>D: resolve session (if token-gated)
    W->>W: dispatch to handler
    W->>D: handler queries
    W-->>F: { success: true, data } or { success: false, error }
```

## ER diagram

```mermaid
erDiagram
    seasons ||--o{ votes : "season_id"
    seasons ||--o{ awards : "season_id"
    seasons ||--o{ attendance : "season_id"
    seasons ||--o{ melee_tournaments : "season_id"
    seasons ||--o{ season_standings : "season_id"
    seasons ||--o{ match_results : "season_id"

    players ||--o{ sessions : "player_id"
    players ||--o{ votes : "player_id"
    players ||--o{ votes : "opponent_id"
    players ||--o{ awards : "player_id"
    players ||--o{ attendance : "player_id"
    players ||--o{ season_standings : "player_id"
    players ||--o{ match_results : "player1_id"
    players ||--o{ match_results : "player2_id"

    leaders ||--o{ votes : "leader_id"

    seasons {
        int id PK
        string name
        int length
        int top_results
    }
    players {
        string id PK
        string name
        string melee_name
        string email
        int active
    }
    leaders {
        string id PK
        string name
        string set
        int active
    }
    votes {
        int id PK
        int season_id FK
        string player_id FK
        string leader_id FK
        string opponent_id FK
        int week
    }
    awards {
        int season_id PK,FK
        string award_name PK
        string player_id PK,FK
        real score
        int rank
    }
    attendance {
        int season_id PK,FK
        int week PK
        string player_id PK,FK
    }
    melee_tournaments {
        int melee_id PK
        int season_id FK
        int round
        string name
        string phase
    }
    season_standings {
        int season_id PK,FK
        int round PK
        string player_id PK,FK
        int wins
        int losses
        int draws
        int match_points
    }
    match_results {
        int id PK
        int season_id FK
        string player1_id FK
        string player2_id FK
        string winner_id
        int is_bye
    }
    sessions {
        string token PK
        string player_id FK
        string device_id
        string email
    }
```

**Notes:**
- `melee_tournaments` links to `season_standings` and `match_results` logically via
  `(season_id, round)` — enforced by `UNIQUE(season_id, round)`, not a declared FK.
- `votes.opponent_id` points to another player (the favorite opponent).
- `awards.rank` (Galactic Ruler 1/2/3) was migrated out-of-band (M4) and is now
  also declared in `schema.sql` — the two match.

## Season lifecycle state machine

```mermaid
stateDiagram-v2
    direction TB

    [*] --> Voting_Closed : startNewSeason (Week 1)

    state "Voting closed" as Voting_Closed
    state "Voting open" as Voting_Open
    state "Paused (sync only)" as Paused
    state "Season ended" as Ended

    Voting_Closed --> Voting_Open : first Wed fire opens
    Voting_Open --> Ended : Wed fire closes (N+1 > length)

    Voting_Closed --> Paused : pauseCurrentSeason
    Voting_Open --> Paused : pauseCurrentSeason
    Paused --> Voting_Closed : resume (was closed)
    Paused --> Voting_Open : resume (was open)

    Ended --> [*]
```

**Advance (not a separate state):** while voting is open, each eligible Wed fire sets
`CURRENT_WEEK` to `Week N+1` and records `LAST_ADVANCED`. `VOTING_OPEN` stays true —
votes simply refer to the new week.

**Advance gate:** week-advance and voting-open happen only when Stockholm local day is
Wednesday AND local time ≥ 22:10 AND `LAST_ADVANCED` ≠ today. Thursday fire retries
without the time gate.

**Two-try open:** the primary Wednesday fire defers if the night has no attendance data;
the retry fire always acts. This ensures voting opens every league night ~1h later at
worst.

## Sync lifecycle

Runs on every cron fire. Idempotent — catches late-published Melee results.

1. **Gate:** skip if no active season
2. **Fetch:** tournaments from Melee.gg; insert new ones
3. **Sync records:** standings + matches for unsynced rounds — delegated to the
   shared data engine `lib/leagueSync.js` (`syncSeasonData`), which the cron sync
   and the admin backfill both call. The engine writes only players /
   melee_tournaments / season_standings / match_results / attendance (never
   `settings`/`awards`); lifecycle logic stays in this trigger.
4. **Attendance:** rebuilt from regular standings (engine, per round)
5. **Awards refresh:** recompute live podiums (Schemer, Ambassador, Ruler, etc.)
6. **Pause gate:** if paused → return (data synced, no lifecycle writes)
7. **Advance gate:** Wednesday + ≥ 22:10 + marker ≠ today
8. **State machine:** open → advance → close (see diagram above)

Statuses: `skipped` / `fetch-failed` / `paused` / `post-close-sync` /
`synced-no-advance` / `synced-deferred` / `voting-opened` / `season-ended` / `advanced`.
