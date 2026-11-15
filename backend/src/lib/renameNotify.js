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
    // Discord answers 204 on success and 4xx for a wrong/revoked webhook; without
    // this check a bad secret looks exactly like a delivered message.
    const res = await fetch(url.trim(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `${label}: ${oldName || '(none)'} → ${newName} (${playerId})`,
        allowed_mentions: { parse: [] },
      }),
      signal: timeoutSignal(),
    });
    if (res && res.ok === false) {
      const detail = typeof res.text === 'function' ? await res.text().catch(() => '') : '';
      console.warn(`[Rename] Discord rejected the notification: ${res.status} ${String(detail).slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn(`[Rename] Discord notification failed: ${err.message}`);
    return false;
  }
}
