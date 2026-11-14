import { requireAdmin } from '../lib/auth.js';
import { badRequest } from '../lib/errors.js';
import { normalizeMeleeName, historyStatements } from '../lib/usernames.js';
import { buildMergePlan, countHeldRows, mergeNote } from '../lib/playerMerge.js';

function toResponse(request, extra = {}) {
  return {
    id: request.id,
    status: 'approved',
    playerId: request.player_id,
    oldMeleeName: request.old_melee_name,
    newMeleeName: request.new_melee_name,
    ...extra,
  };
}

function changeCount(result) {
  if (result && result.meta && typeof result.meta.changes === 'number') return result.meta.changes;
  if (result && typeof result.changes === 'number') return result.changes;
  return null;
}

// Rows that would change hands if an auto-created holder is absorbed. Used to
// require an explicit confirmation instead of silently moving somebody's
// career into another account.
async function assertMergeConfirmed(DB, orphans, newMeleeName, body) {
  if (orphans.length === 0 || body.confirmMerge === true) return;
  const held = [];
  let rows = 0;
  for (const orphan of orphans) {
    const count = await countHeldRows(DB, orphan.id);
    rows += count;
    held.push(`${orphan.id} (${count} row${count === 1 ? '' : 's'})`);
  }
  if (rows === 0) return;
  throw badRequest(
    `"${newMeleeName}" is already held by ${orphans.length} auto-created row(s): ${held.join(', ')}. `
    + 'Approving absorbs their results into this player. Re-send with confirmMerge: true to proceed.'
  );
}

// Loads the queue row and claims it before any work happens: a concurrent or
// repeated approval then sees 'approved' instead of building a stale plan.
// Returns null for the admin-direct form (no request row involved).
async function claimRequest(DB, requestId) {
  const request = await DB.prepare('SELECT * FROM rename_requests WHERE id = ?').bind(requestId).first();
  if (!request) throw badRequest('Rename request not found.');
  if (request.status === 'approved') return { request, alreadyApproved: true };
  if (request.status !== 'pending') {
    throw badRequest(`Rename request is already ${request.status}.`);
  }
  const claim = await DB.prepare(
    'UPDATE rename_requests SET status = ?, resolved_at = ?, resolved_by = ? WHERE id = ? AND status = ?'
  ).bind('approved', new Date().toISOString(), 'admin', request.id, 'pending').run();
  if (changeCount(claim) === 0) {
    const fresh = await DB.prepare('SELECT * FROM rename_requests WHERE id = ?').bind(request.id).first();
    if (fresh && fresh.status === 'approved') return { request: fresh, alreadyApproved: true };
    throw badRequest(`Rename request is already ${fresh ? fresh.status : 'resolved'}.`);
  }
  return { request };
}

export async function handleApproveRename(body, env) {
  requireAdmin(body, env);
  const { DB } = env;

  let request = null;
  let claimedNow = false;
  let playerId = body.playerId;
  let newMeleeName = body.newMeleeName;

  if (body.requestId != null) {
    const claimed = await claimRequest(DB, body.requestId);
    request = claimed.request;
    playerId = request.player_id;
    newMeleeName = request.new_melee_name;
    if (claimed.alreadyApproved) {
      const current = await DB.prepare('SELECT melee_name FROM players WHERE id = ?').bind(playerId).first();
      const currentName = String(current?.melee_name || '').toLowerCase();
      const target = String(newMeleeName).toLowerCase();
      const origin = String(request.old_melee_name || '').toLowerCase();
      if (currentName === target) return toResponse(request, { alreadyApproved: true });
      if (currentName !== origin) {
        // The player has moved on since this request was written; replaying it
        // would silently undo a later rename.
        console.warn(`[Rename] Ignoring stale approved request ${request.id}: ${playerId} is at `
          + `"${current?.melee_name ?? '(no row)'}", request targeted "${request.old_melee_name}"`);
        return toResponse(request, { alreadyApproved: true });
      }
      // The row says approved but the batch never landed (the revert after a
      // failed batch can fail too). Re-applying is the admin's only way out.
      console.warn(`[Rename] Re-applying approved request ${request.id}: ${playerId} still has `
        + `${current ? current.melee_name : '(no row)'}`);
    } else {
      claimedNow = true;
    }
  } else if (!playerId) {
    throw badRequest('requestId or playerId is required.');
  }

  try {
    const player = await DB.prepare('SELECT * FROM players WHERE id = ?').bind(playerId).first();
    if (!player) throw badRequest('Player not found.');

    newMeleeName = normalizeMeleeName(newMeleeName);
    const currentName = player.melee_name || '';
    const renamed = newMeleeName.toLowerCase() !== currentName.toLowerCase();

    const holders = (await DB.prepare(
      'SELECT * FROM players WHERE LOWER(melee_name) = LOWER(?)'
    ).bind(newMeleeName).all()).results || [];
    const others = holders.filter((holder) => holder.id !== playerId);
    const conflicting = others.find((holder) => holder.email);
    if (conflicting) {
      throw badRequest(`The Melee username "${newMeleeName}" already belongs to ${conflicting.id}.`);
    }
    const orphans = others.filter((holder) => !holder.email);

    await assertMergeConfirmed(DB, orphans, newMeleeName, body);

    const statements = [];
    if (renamed) {
      if (currentName) {
        statements.push(...historyStatements(DB, { playerId, meleeName: currentName, source: 'admin' }));
      }
      // Identity only: players.name is owned by the Melee DisplayName sync, so a
      // rename must not overwrite a member's chosen display name.
      statements.push(DB.prepare('UPDATE players SET melee_name = ? WHERE id = ?')
        .bind(newMeleeName, playerId));
    }

    let merged = [];
    let note = null;
    if (orphans.length > 0) {
      const plan = await buildMergePlan(DB, playerId, orphans.map((orphan) => orphan.id));
      if (!plan) throw badRequest('Orphan row disappeared during merge.');
      statements.push(...plan.statements);
      merged = plan.orphans.map((orphan) => orphan.id);
      note = mergeNote(plan.summary);
    }

    if (request) {
      statements.push(DB.prepare('UPDATE rename_requests SET note = ? WHERE id = ?').bind(note, request.id));
    } else {
      const now = new Date().toISOString();
      statements.push(DB.prepare(
        'INSERT INTO rename_requests (player_id, old_melee_name, new_melee_name, status, requested_at, resolved_at, resolved_by, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(playerId, currentName, newMeleeName, 'approved', now, now, 'admin', note || 'admin-direct'));
    }

    await DB.batch(statements);

    return {
      status: 'approved',
      playerId,
      oldMeleeName: currentName,
      newMeleeName,
      merged,
      note,
    };
  } catch (err) {
    if (request && claimedNow) {
      await DB.prepare(
        "UPDATE rename_requests SET status = ?, resolved_at = ?, resolved_by = ? WHERE id = ?"
      ).bind('pending', null, null, request.id).run().catch(() => {});
    }
    throw err;
  }
}
