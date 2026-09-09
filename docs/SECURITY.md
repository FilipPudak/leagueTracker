# Security Model

Cloudflare Worker backend with static frontend (GitHub Pages). No shared secret, no Google sign-in. Identity established by **per-device session tokens**.

## Session Tokens

- User links on a device → backend mints UUID token → stored in D1 `sessions` table → client persists in `localStorage`
- Every request sends token → backend resolves to linked player
- Stale sessions lazily deleted on next use
- **90-day rolling TTL** from `last_active` timestamp

## Linking

- Email + player name from public roster
- **One email ↔ one player** — enforced at link time
- **One player ↔ one email** — changing requires admin
- Re-linking same email on new device creates new session, reuses player

## Voting

- **One vote per player per week** — `UNIQUE(season_id, week, player_id)` on `votes` table
- **Both fields mandatory** — leader and opponent, server-side validated
- **Self-vote prohibited** — opponent_id ≠ player_id
- **Editable while open** — `updateVote` replaces both fields, re-checks constraints
- **Privacy invariant** — no endpoint exposes voter→opponent mapping; only aggregate tallies

## Privacy Guard

Lint-style test (`test/privacy/privacyGuard.test.js`) asserts:
- No handler returns `opponent_id` alongside voter identity in the same response
- `getAppData` does not expose `opponent_id` except in `currentVote` (own data)

## Admin Actions

- Require `adminToken` in request body matching `ADMIN_SECRET` env var
- **Constant-time comparison** — prevents timing side-channel
- Actions: `startNewSeason`, `syncNow`, `pauseCurrentSeason`, `resumeCurrentSeason`, `materializePastAwards`, leader management

## Rate Limiting

- Best-effort per Worker isolate (30 requests/minute per IP)
- Documented, not a security guarantee

## Accepted Limitation: Email Not Verified

Backend trusts asserted email. For casual league use, accepted. Mitigations:
- Mandatory one-time link before voting
- One vote per player per week (UNIQUE constraint)
- Full audit logging (Cloudflare Worker logs)
- Unlink/revoke: user can unlink device; admin can unclaim player

## Admin Secret

- `ADMIN_SECRET` encrypted in Cloudflare dashboard (not in `wrangler.toml`)
- Never logged, never returned in responses
- Used only for constant-time comparison in admin actions
