# Melee.gg API Notes

Reference for the external Melee.gg API used by the sync and backfill triggers.
See [`ARCHITECTURE.md`](ARCHITECTURE.md) for how sync fits into the system.

## Authentication

- HTTP Basic Auth: `Authorization: Basic base64(CLIENT_ID:CLIENT_SECRET)`
- Credentials stored as encrypted env vars (not in `wrangler.toml`)
- No token refresh — each request is independently authenticated

## Endpoints

| Endpoint | Used for |
|----------|----------|
| `GET /api/tournament/list` | Discover league tournaments |
| `GET /api/standing/list/current/{tournamentId}` | Player standings per tournament |
| `GET /api/match/list/{tournamentId}` | Match results per tournament |
| `GET /api/player/{username}` | Player profile lookup |

## Pagination

- Query params: `variables.page` (1-based) and `variables.pageSize`
- **Not** `Skip` / `Take` (common wrong assumption)
- Response fields: `HasMore`, `RecordsTotal`, `Content`
- Client uses `pageSize=25`, max 20 pages (runaway-loop abort)

## Field quirks

All response fields are **PascalCase**.

| Quirk | Detail |
|-------|--------|
| Matches have no numeric `ID` | Only `Guid` (UUID string) — stored as `melee_match_id TEXT` |
| No `WinnerId` | Compare `Competitors[i].GameWins` |
| No `StartDate` on tournaments | Use `LastPairDateTime` |
| No `NumberOfRounds` | Derive from `Phases[0].Rounds.length` |
| No search endpoint | Tournament discovery is name-pattern matching only |
| No decklists | Leader attribution is vote-based (CONTEXT §8) |

## Standings fields

`Rank`, `Points`, `MatchWins`, `MatchDraws`, `MatchLosses`, `MatchCount`,
`GameWins`, `GameDraws`, `GameLosses`, `GameCount`,
`OpponentMatchWinPercentage`, `OpponentGameWinPercentage`,
`Team.Players[].Username` / `.DisplayName` / `.Name`

## Match fields

`Competitors[].Team.Players[]`, `Competitors[].GameWins`, `Competitors[].GameByes`,
`Guid`, `ByeReason`, `ResultString`, `RoundNumber`, `TournamentId`, `PhaseId`, `RoundId`

## Tournament fields

Numeric `ID`, `Name`, `Game`, `Status`, `StatusDescription`, `LastPairDateTime`,
`Formats[]`, `OrganizationId`, `Phases[].Rounds[]`

## Tournament name patterns

Discovery is regex-based (organizers hand-type names):

- S1: `SWU Wednesday league {DD/MM}` — no season number
- S2–S4: `SWU Wednesday league season {N} {DD/MM}` — no explicit week
- S5+: `SWU Wednesday league season {N} {DD/MM} (week {W})`
- Cut/special: Top 8 / Top 4 / Playoff / Championship / Best of the Rest / Finale
- Excluded: `prerelease`, `draft`, `clone`, `budget draft`

Round numbers are assigned by date order — explicit `(week N)` labels are not trusted
(CONTEXT §6).

## Known gotchas

1. **Pagination:** `variables.page`, not `Skip`/`Take`
2. **Match identity:** `Guid` only, no numeric `ID`
3. **No winner field:** compare `GameWins`
4. **No start date:** use `LastPairDateTime`
5. **Workers subrequest limit:** 50 per invocation — backfill must batch
6. **Name quirks:** leading tabs observed; some events have no date
7. **S1 naming:** no season number in tournament names — defaults to season 1
8. **No cross-tournament player history endpoint**
9. **Bounty Hunter needs prior season's top 4** — unavailable in S1
