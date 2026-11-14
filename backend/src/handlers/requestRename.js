import { getSettings, parseSeasonId } from '../db/queries.js';
import { MeleeClient } from '../lib/melee.js';
import { badRequest } from '../lib/errors.js';
import { normalizeMeleeName, findPlayersByMeleeName } from '../lib/usernames.js';
import { notifyRenameRequest } from '../lib/renameNotify.js';

// Best-effort confirmation that the declared handle exists on Melee right now
// (1-2 fetches). Never blocks the request: unknown/failed check ⇒ null.
async function checkMeleeHint(env, newMeleeName) {
  try {
    if (!env.MELEE_CLIENT_ID || !env.MELEE_CLIENT_SECRET) return null;
    const settings = await getSettings(env.DB);
    const seasonId = parseSeasonId(settings.ACTIVE_SEASON_ID);
    if (!seasonId) return null;
    const latest = await env.DB.prepare(
      'SELECT melee_id FROM melee_tournaments WHERE season_id = ? ORDER BY round DESC LIMIT 1'
    ).bind(seasonId).first();
    if (!latest) return null;
    const client = new MeleeClient(env.MELEE_CLIENT_ID, env.MELEE_CLIENT_SECRET);
    const standings = await client.getStandings(latest.melee_id);
    const found = (standings.Content || []).some((standing) => {
      const username = standing.Team?.Players?.[0]?.Username;
      return username && username.toLowerCase() === newMeleeName.toLowerCase();
    });
    return found ? 'found' : 'not-found';
  } catch (err) {
    console.warn(`[Rename] Melee hint check failed: ${err.message}`);
    return null;
  }
}

// The hint is decorative; the member's row is already written by the time this
// runs, and a slow/429 Melee night must not stretch the request. The Melee client
// retries with backoff, so the loser of the race is abandoned rather than awaited.
const HINT_TIMEOUT_MS = 1500;

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
    if (timer && typeof timer.unref === 'function') timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// D1 reports how many rows an UPDATE touched; when the driver is silent we treat
// the write as applied rather than risk a duplicate queue row.
function changed(result) {
  const changes = result?.meta?.changes ?? result?.changes;
  return changes == null ? true : changes > 0;
}

export async function handleRequestRename(body, env, session) {
  if (!session) {
    const err = new Error('Session expired. Please re-link to continue.');
    err.status = 401;
    throw err;
  }
  const { DB } = env;
  const player = await DB.prepare('SELECT * FROM players WHERE id = ?').bind(session.player_id).first();
  if (!player) throw badRequest('Player not found.');

  const newMeleeName = normalizeMeleeName(body.newMeleeName);
  const currentName = player.melee_name || '';
  if (newMeleeName.toLowerCase() === currentName.toLowerCase()) {
    throw badRequest('That is already your current Melee username.');
  }

  // Email-bearing holders are a different account. Email-less rows are the
  // auto-created split this feature merges on approval — they must not block
  // the member from declaring the name.
  const holders = await findPlayersByMeleeName(DB, newMeleeName);
  if (holders.some((holder) => holder.id !== player.id && holder.email)) {
    throw badRequest(`The Melee username "${newMeleeName}" already belongs to another player.`);
  }

  // Persist first: the Melee hint below is advisory and may be slow or failing.
  // Re-submitting while a request is pending overwrites it, so a typo costs the
  // member a retry instead of an admin rejection.
  const requestedAt = new Date().toISOString();
  let requestId = null;
  let updated = false;

  const pending = await DB.prepare(
    "SELECT id FROM rename_requests WHERE player_id = ? AND status = 'pending'"
  ).bind(player.id).first();

  if (pending) {
    // Guarded on status: an admin may have resolved the row between the SELECT
    // and this write, in which case the member gets a fresh request instead of
    // resurrecting a resolved one.
    const claim = await DB.prepare(
      'UPDATE rename_requests SET old_melee_name = ?, new_melee_name = ?, melee_hint = ?, requested_at = ? WHERE id = ? AND status = ?'
    ).bind(currentName, newMeleeName, null, requestedAt, pending.id, 'pending').run();
    if (changed(claim)) {
      requestId = pending.id;
      updated = true;
    }
  }

  if (requestId == null) {
    const inserted = await DB.prepare(
      'INSERT INTO rename_requests (player_id, old_melee_name, new_melee_name, status, requested_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(player.id, currentName, newMeleeName, 'pending', requestedAt).run();
    requestId = inserted?.meta?.last_row_id ?? null;
    if (requestId == null) {
      const created = await DB.prepare(
        "SELECT id FROM rename_requests WHERE player_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1"
      ).bind(player.id).first();
      requestId = created?.id ?? null;
    }
    if (requestId != null) {
      // Two devices submitting in the same second can both miss the SELECT above;
      // keep only the newest pending row so the queue cannot show a stale duplicate.
      await DB.prepare(
        "DELETE FROM rename_requests WHERE player_id = ? AND status = 'pending' AND id < ?"
      ).bind(player.id, requestId).run();
    }
  }

  const meleeHint = await withTimeout(checkMeleeHint(env, newMeleeName), HINT_TIMEOUT_MS);
  if (meleeHint && requestId != null) {
    await DB.prepare('UPDATE rename_requests SET melee_hint = ? WHERE id = ?')
      .bind(meleeHint, requestId).run();
  }

  await notifyRenameRequest(env, {
    playerId: player.id,
    oldName: currentName,
    newName: newMeleeName,
    updated,
  });

  return {
    id: requestId,
    status: 'pending',
    updated,
    oldMeleeName: currentName,
    newMeleeName,
    requestedAt,
    meleeHint,
  };
}
