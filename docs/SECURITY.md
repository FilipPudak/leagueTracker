# Security model

- **API_SECRET** — the backend is deployed as `ANYONE_ANONYMOUS` because it is called
  server-to-server from the frontend and therefore cannot require signed-in users (that
  would 401). The `API_SECRET` check in `doPost` is what actually rejects unknown callers,
  making anonymous accessibility safe.
- **Google identity for voting** — votes and account links are bound to the player whose
  Google email (`Session.getActiveUser().getEmail()`) is linked. A user can only act as
  their own linked player; anonymous callers are blocked both by the frontend guard and by
  the `ANYONE` access level (signed-in Google account required).
- **Admin lifecycle** — week advancement (`advanceLeagueWeek`) is not exposed via the
  public API; it runs only via a time-driven trigger or manual invocation.

## Accepted limitation: client-asserted email

The backend runs as `ANYONE_ANONYMOUS` because it is called **server-to-server** from the
frontend's `UrlFetchApp`, which carries no Google user token. As a result, the backend
cannot independently re-verify the email against Google on each request — it trusts the
`userEmail` asserted by the frontend proxy, and the frontend obtains that email from the
signed-in Google user (`Session.getActiveUser().getEmail()`).

In practice, exploiting this requires knowing the `API_SECRET` (which is server-side only,
never sent to the browser, and never committed), so it is accepted for casual-league use.
Mitigations already in place:

- Mandatory one-time account link step before any vote is accepted.
- One vote per email per week, enforced under a script lock
  (`hasSubmittedThisWeek` + `LockService`).
- Full audit logging on every `getAppData`, `linkGoogleAccount`, and `submitVote` call
  (View → Executions) so anomalies can be detected and corrected manually.

**Deferred upgrade:** if competitive integrity or public security review ever matters,
replace the client-asserted email with a verified token: the frontend sends
`ScriptApp.getOAuthToken()` and the backend resolves it against
`https://www.googleapis.com/oauth2/v3/userinfo`, ignoring the asserted email.
See the local `docs/phase2-token-verification.md` note (git-ignored).
