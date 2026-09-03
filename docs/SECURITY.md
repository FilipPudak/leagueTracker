# Security model

The backend runs as `ANYONE_ANONYMOUS` because it is called directly from a static, no-auth
client (GitHub Pages) via `fetch` to `/exec`. There is no shared secret and no Google sign-in.
Identity for voting is established by a **per-device session token** minted at link time.

- **Per-device session tokens** — when a user links on a device, the backend mints a UUID
  token stored in the `Sessions` sheet (one row per device, many rows per player) and returns
  it to the client, which persists it in `localStorage`. Every subsequent request sends the
  token; the backend resolves it to the linked player and lazily deletes stale sessions.
- **Link is keyed on an email + player name** — the user types an email and picks a player
  from the (public) active roster. The backend enforces ownership: an email cannot be claimed
  by two players, a player cannot be claimed by two emails, and a player re-picking their own
  already-claimed identity on a new device re-links cleanly.
- **One vote per player per week** — enforced under a script lock
  (`hasSubmittedThisWeek` + `LockService`), so concurrent requests cannot both pass the check.
- **Admin lifecycle** — week advancement (`advanceLeagueWeek`), season start
  (`startNewSeason`), and player sync (`syncPlayersFromWebsite`) are not exposed via the
  public API; they run only via time-driven triggers or manual invocation.
- **Admin unclaim (revocation)** — clearing a `Players` col D email unclaims the player and
  invalidates their sessions; stale tokens are lazily GC'd on their next request. This is a
  manual sheet edit (no `onEdit` trigger — a negative decision deliberately kept out to avoid
  implicit writes to player data on random edits).

## Accepted limitation: email is not Google-verified

The backend is stateless at the identity layer — it trusts the email asserted by the linking
user (typed into the form). For a casual-league hobby project this is accepted. Exploits would
require either guessing another player's email `+` organization name (both effectively public
to league members) and claiming their identity **before** the legitimate owner does, or being
handed a valid session token. Mitigations already in place:

- Mandatory one-time link step before any vote is accepted.
- One vote per player per week under a script lock.
- Full audit logging on every `getAppData`, `linkAccount`, `submitVote`, and `unlinkAccount`
  call (View → Executions) so anomalies can be detected and corrected.
- Unlink/revoke story: user can unlink a device ("Not you?"); admin can unclaim a player.

**Deferred upgrade:** if competitive integrity or public security review ever matters, replace
the asserted email with Google-verified identity (e.g. the frontend sends an OAuth token and the
backend resolves it against `https://www.googleapis.com/oauth2/v3/userinfo`). See the local
`docs/phase2-token-verification.md` note (git-ignored).
