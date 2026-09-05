# Security model

The backend is a Cloudflare Worker with no shared secret and no Google sign-in. The static
client (GitHub Pages) calls it directly with `fetch`. Identity for voting is established by a
**per-device session token** minted at link time.

- **Per-device session tokens** — when a user links on a device, the backend mints a UUID
  token stored in the D1 `sessions` table (one row per device, many rows per player) and returns
  it to the client, which persists it in `localStorage`. Every subsequent request sends the
  token; the backend resolves it to the linked player and lazily deletes stale sessions.
- **Link is keyed on an email + player name** — the user types an email and picks a player
  from the (public) active roster. The backend enforces ownership: an email cannot be claimed
  by two players, a player cannot be claimed by two emails, and a player re-picking their own
  already-claimed identity on a new device re-links cleanly.
- **One vote per player per week** — enforced by a `UNIQUE(season_id, week, player_id)`
  constraint on the `leader_votes` table, so concurrent requests cannot both succeed.
- **Session TTL** — sessions expire after 90 days of inactivity. The `last_active`
  timestamp is refreshed on each successful vote and link, so active weekly voters
  never expire. An expired session is lazily deleted on next use.
- **Admin lifecycle** — week advancement (`advanceWeek`), and player sync (`syncPlayers`)
  run as Cloudflare Worker cron triggers (scheduled handlers) or manual invocation via
  `curl`/`wrangler`. They are not exposed through the public API.
- **Admin unclaim (revocation)** — clearing a player's email in D1 unclaims the player and
  invalidates their sessions; stale tokens are lazily GC'd on their next request.

## Accepted limitation: email is not Google-verified

The backend is stateless at the identity layer — it trusts the email asserted by the linking
user (typed into the form). For a casual-league hobby project this is accepted. Exploits would
require either guessing another player's email `+` organization name (both effectively public
to league members) and claiming their identity **before** the legitimate owner does, or being
handed a valid session token. Mitigations already in place:

- Mandatory one-time link step before any vote is accepted.
- One vote per player per week under a UNIQUE constraint.
- Full audit logging on every `getAppData`, `linkAccount`, `submitVote`, and `unlinkAccount`
  call (Cloudflare Worker logs) so anomalies can be detected and corrected.
- Unlink/revoke story: user can unlink a device ("Not you?"); admin can unclaim a player.

**Deferred upgrade:** if competitive integrity or public security review ever matters, replace
the asserted email with Google-verified identity (e.g. the static client sends an OAuth token and the
backend resolves it against `https://www.googleapis.com/oauth2/v3/userinfo`).
