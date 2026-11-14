// Admin notification for new rename requests. Fire-and-forget: a missing secret,
// a failing webhook or a hanging call must never fail the member's request.
const WEBHOOK_TIMEOUT_MS = 2000;

function timeoutSignal() {
  if (typeof AbortSignal === 'undefined' || !AbortSignal.timeout) return undefined;
  return AbortSignal.timeout(WEBHOOK_TIMEOUT_MS);
}

export async function notifyRenameRequest(env, { playerId, oldName, newName, updated = false }) {
  const url = env && env.DISCORD_WEBHOOK_URL;
  if (!url) return false;
  const label = updated ? 'Rename request updated' : 'Rename request';
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `${label}: ${oldName || '(none)'} → ${newName} (${playerId})`,
        allowed_mentions: { parse: [] },
      }),
      signal: timeoutSignal(),
    });
    return true;
  } catch (err) {
    console.warn(`[Rename] Discord notification failed: ${err.message}`);
    return false;
  }
}
