import { requireAdmin } from '../lib/auth.js';
import { badRequest } from '../lib/errors.js';
import { fetchSetLeaders, matchLeader, normalizeAspects } from '../lib/aspectLookup.js';

async function resolveAspects(leader, payloadAspects, setKey, lookupFor) {
  if (payloadAspects) return { aspects: payloadAspects, aspectsResolved: true };
  if (!setKey) return { aspects: null, aspectsResolved: false, reason: 'no set' };
  const lookup = await lookupFor(setKey);
  if (lookup.error) {
    const reason = lookup.error === 'incomplete' ? 'lookup incomplete' : 'lookup failed';
    return { aspects: null, aspectsResolved: false, reason };
  }
  const m = matchLeader(lookup.candidates, leader.name);
  if (m?.aspects) return { aspects: m.aspects, aspectsResolved: true };
  if (m?.badData) return { aspects: null, aspectsResolved: false, reason: 'bad data' };
  if (m?.suggestion) {
    return { aspects: null, aspectsResolved: false, reason: 'no match', swuDbSuggestion: m.suggestion };
  }
  return { aspects: null, aspectsResolved: false, reason: 'no match' };
}

export async function handleAddLeaders(body, env) {
  const { DB } = env;
  requireAdmin(body, env);
  const { leaders } = body;

  if (!Array.isArray(leaders)) throw badRequest('leaders must be an array.');

  const existing = await DB.prepare('SELECT id, name, "set", aspects FROM leaders').all();
  const existingRows = (existing.results || []).map(l => ({
    id: l.id,
    name: l.name.toLowerCase(),
    set: (l.set || '').toLowerCase(),
    aspects: l.aspects || null,
  }));

  const lookups = new Map();
  const lookupFor = (setKey) => {
    if (!lookups.has(setKey)) lookups.set(setKey, fetchSetLeaders(setKey));
    return lookups.get(setKey);
  };

  const added = [];
  const skipped = [];
  const filled = [];

  for (const leader of leaders) {
    if (!leader || !leader.name) {
      skipped.push({ name: leader?.name || '(unnamed)', reason: 'missing name' });
      continue;
    }
    const nameKey = leader.name.toLowerCase();
    const setKey = (leader.set || '').toLowerCase();
    const provided = leader.aspects !== undefined && leader.aspects !== null && String(leader.aspects).trim() !== '';
    let payloadAspects = null;
    if (provided) {
      payloadAspects = normalizeAspects(leader.aspects);
      if (!payloadAspects) {
        skipped.push({ name: leader.name, reason: 'invalid aspects' });
        continue;
      }
    }

    const match = existingRows.find(e =>
      e.name === nameKey && (!e.set || !setKey || e.set === setKey)
    );
    if (match) {
      if (payloadAspects && !match.aspects) {
        await DB.prepare('UPDATE leaders SET aspects = ? WHERE id = ?').bind(payloadAspects, match.id).run();
        match.aspects = payloadAspects;
        filled.push({ id: match.id, name: leader.name, set: leader.set, aspects: payloadAspects });
      } else {
        skipped.push({ name: leader.name, reason: 'duplicate' });
      }
      continue;
    }

    const { aspects, aspectsResolved, reason, swuDbSuggestion } =
      await resolveAspects(leader, payloadAspects, setKey, lookupFor);

    const id = crypto.randomUUID();

    await DB.prepare(
      'INSERT INTO leaders (id, name, "set", aspects, active) VALUES (?, ?, ?, ?, 1)'
    ).bind(id, leader.name, leader.set || null, aspects).run();

    const entry = { id, name: leader.name, set: leader.set, aspects, aspectsResolved };
    if (reason) entry.reason = reason;
    if (swuDbSuggestion) entry.swuDbSuggestion = swuDbSuggestion;
    added.push(entry);
    existingRows.push({ id, name: nameKey, set: setKey, aspects });
  }

  const unresolved = added.filter((a) => !a.aspectsResolved).length;
  return {
    added,
    skipped,
    filled,
    summary: {
      requested: leaders.length,
      added: added.length,
      skipped: skipped.length,
      filled: filled.length,
      unresolved,
    },
  };
}

export async function handleSetLeadersActive(body, env) {
  const { DB } = env;
  requireAdmin(body, env);
  const { leaderIds, active } = body;

  if (!Array.isArray(leaderIds)) throw badRequest('leaderIds must be an array.');

  for (const id of leaderIds) {
    await DB.prepare('UPDATE leaders SET active = ? WHERE id = ?').bind(active ? 1 : 0, id).run();
  }

  return { updated: leaderIds.length };
}

export async function handleRemoveLeaders(body, env) {
  const { DB } = env;
  requireAdmin(body, env);
  const { leaderIds } = body;

  if (!Array.isArray(leaderIds)) throw badRequest('leaderIds must be an array.');

  const removed = [];
  const refused = [];

  for (const id of leaderIds) {
    const referenced = await DB.prepare(
      'SELECT 1 FROM votes WHERE leader_id = ? LIMIT 1'
    ).bind(id).first();

    if (referenced) {
      const leader = await DB.prepare('SELECT name FROM leaders WHERE id = ?').bind(id).first();
      refused.push({ id, name: leader?.name || id, reason: 'referenced by votes' });
      continue;
    }

    await DB.prepare('DELETE FROM leaders WHERE id = ?').bind(id).run();
    removed.push(id);
  }

  return { removed, refused };
}
