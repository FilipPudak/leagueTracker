import { PHASE } from './constants.js';

const LEAGUE_REGEX = /^SWU Wednesday league(?: season (\d+))?(?:\s+\d{1,2}\/\d{1,2}|\s+(?:top [48]|best of the rest|playoff|championship|finale))/i;
const EXCLUDED_KEYWORDS = ['prerelease', 'draft', 'clone', 'budget draft'];

const PHASE_ORDER = { [PHASE.CUT]: 0, [PHASE.REGULAR]: 1, [PHASE.SIDE]: 2 };

export function classifyPhase(name) {
  const lower = name.toLowerCase();
  if (/best of the rest|finale/i.test(lower)) return PHASE.SIDE;
  if (/top [48]|playoff|championship/i.test(lower)) return PHASE.CUT;
  return PHASE.REGULAR;
}

export function isLeagueTournament(name) {
  if (!LEAGUE_REGEX.test(name)) return false;
  const lower = name.toLowerCase();
  return !EXCLUDED_KEYWORDS.some(kw => lower.includes(kw));
}

export function extractSeasonAndRound(name) {
  const match = name.match(LEAGUE_REGEX);
  if (!match) return null;
  const weekMatch = name.match(/\(week (\d+)\)/i);
  const week = weekMatch ? parseInt(weekMatch[1], 10) : null;
  return { seasonNum: match[1] ? parseInt(match[1], 10) : null, week };
}

export function sortRoundsDeterministic(tournaments) {
  return [...tournaments].sort((a, b) => {
    const da = new Date(a.StartDate || a.LastPairDateTime || 0);
    const db = new Date(b.StartDate || b.LastPairDateTime || 0);
    if (da - db !== 0) return da - db;
    const pa = PHASE_ORDER[classifyPhase(a.Name)] ?? 1;
    const pb = PHASE_ORDER[classifyPhase(b.Name)] ?? 1;
    if (pa !== pb) return pa - pb;
    return (a.ID || 0) - (b.ID || 0);
  });
}

export async function fetchLeagueTournaments(client, { targetSeason } = {}) {
  let page = 0;
  const pageSize = 250;
  let hasMore = true;
  const all = [];

  while (hasMore) {
    // Callers rely on a hard failure here: partial or empty results must never
    // look like "the league simply has no tournaments".
    const response = await client.listTournaments(null, page, pageSize);

    const content = response.Content || [];
    if (!content.length) break;
    for (const t of content) {
      if (!isLeagueTournament(t.Name)) continue;
      const info = extractSeasonAndRound(t.Name);
      if (!info) continue;
      if (!t.StartDate && !t.LastPairDateTime) continue;
      const seasonNum = info.seasonNum || 1;
      if (targetSeason != null && seasonNum !== targetSeason) continue;
      all.push({ ...t, seasonNum, phase: classifyPhase(t.Name) });
    }

    const total = response.RecordsTotal || response.TotalCount || 0;
    page++;
    hasMore = page * pageSize < total;
  }

  return sortRoundsDeterministic(all);
}

export function buildWeekMap(tournaments, existingRoundMap = new Map()) {
  const weekMap = new Map();
  const used = new Set([...existingRoundMap.values()].filter(r => Number.isInteger(r) && r > 0));
  let next = 1;
  const takeRound = () => {
    while (used.has(next)) next++;
    used.add(next);
    return next++;
  };

  const regulars = [];
  const specials = [];
  for (const t of tournaments) {
    const phase = t.phase || classifyPhase(t.Name);
    if (phase === PHASE.REGULAR) regulars.push(t);
    else specials.push(t);
  }

  for (const t of regulars) {
    const existingRound = existingRoundMap.get(t.ID);
    const round = existingRound != null ? existingRound : takeRound();
    weekMap.set(t.ID, {
      meleeId: t.ID,
      round,
      name: t.Name,
      date: t.StartDate || t.LastPairDateTime || null,
      phase: PHASE.REGULAR,
      status: t.Status,
      statusDescription: t.StatusDescription,
    });
  }

  for (const t of specials) {
    const existingRound = existingRoundMap.get(t.ID);
    const round = existingRound != null ? existingRound : takeRound();
    const phase = t.phase || classifyPhase(t.Name);
    weekMap.set(t.ID, {
      meleeId: t.ID,
      round,
      name: t.Name,
      date: t.StartDate || t.LastPairDateTime || null,
      phase,
      status: t.Status,
      statusDescription: t.StatusDescription,
    });
  }

  return weekMap;
}

export function createPlayerFinder(DB, { onCreated } = {}) {
  const playerMap = new Map();
  let nextPlayerNum = 1;
  let initialized = false;

  async function init() {
    if (initialized) return;
    const allPlayersResult = await DB.prepare('SELECT * FROM players').all();
    const allPlayers = allPlayersResult.results || [];
    for (const p of allPlayers) {
      if (p.melee_name) playerMap.set(p.melee_name.toLowerCase(), p);
    }
    const liveMax = allPlayers.reduce((max, p) => {
      const m = p.id?.match(/^P(\d+)$/);
      return m ? Math.max(max, parseInt(m[1], 10)) : max;
    }, 0);
    // Merging away the highest id would otherwise recycle it; PLAYER_SEQ is the
    // durable high-water mark written by the merge.
    const seqRow = await DB.prepare("SELECT value FROM settings WHERE key = 'PLAYER_SEQ'").first();
    const seq = seqRow ? parseInt(seqRow.value, 10) : 0;
    nextPlayerNum = Math.max(liveMax, Number.isFinite(seq) ? seq : 0) + 1;
    initialized = true;
  }

  // AsmoConnectId is an account-level Melee id: verification signal only, never
  // a join key (Melee can reassign it). Fill when unknown; a mismatch on an
  // existing value signals an account change or a recycled username.
  async function captureAsmo(player, asmoConnectId, username) {
    if (!asmoConnectId) return;
    const stored = player.melee_guid;
    if (!stored) {
      await DB.prepare('UPDATE players SET melee_guid = ? WHERE id = ?').bind(asmoConnectId, player.id).run();
      player.melee_guid = asmoConnectId;
      return;
    }
    if (String(stored) !== String(asmoConnectId)) {
      console.warn(`[Finder] AsmoConnectId mismatch for ${player.id} (${username}): stored ${stored}, payload ${asmoConnectId} — possible account change or recycled username`);
    }
  }

  // players.name follows Melee's DisplayName, never the Name fallback: Name is the
  // legal-looking real name, so a blank DisplayName must leave the stored (possibly
  // member-chosen) name alone instead of publishing it.
  async function refreshName(player, meleeDisplayName, username) {
    if (!meleeDisplayName) return;
    const next = String(meleeDisplayName).trim();
    if (!next || next === player.name) return;
    await DB.prepare('UPDATE players SET name = ? WHERE id = ?').bind(next, player.id).run();
    console.log(`[Finder] DisplayName ${player.id} (${username}) "${player.name}" → "${next}"`);
    player.name = next;
  }

  async function create(username, displayName, asmoConnectId) {
    const id = `P${String(nextPlayerNum++).padStart(3, '0')}`;
    const name = displayName || username;
    const now = new Date().toISOString();
    await DB.batch([
      DB.prepare('INSERT INTO players (id, name, melee_name, melee_guid, active) VALUES (?, ?, ?, ?, 1)')
        .bind(id, name, username, asmoConnectId || null),
      DB.prepare('INSERT INTO player_usernames (player_id, melee_name, name_lower, source, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(id, username, username.toLowerCase(), 'sync', now, now),
    ]);
    const player = { id, name, melee_name: username, melee_guid: asmoConnectId || null, active: 1 };
    playerMap.set(username.toLowerCase(), player);
    if (onCreated) onCreated({ ...player });
    return id;
  }

  async function find(username, displayName, asmoConnectId) {
    await init();
    const key = username.toLowerCase();

    if (playerMap.has(key)) {
      const cached = playerMap.get(key);
      const dbCheck = await DB.prepare('SELECT id, name FROM players WHERE id = ?').bind(cached.id).first();
      if (dbCheck) {
        cached.name = dbCheck.name;
        await refreshName(cached, displayName, username);
        await captureAsmo(cached, asmoConnectId, username);
        return cached.id;
      }
      playerMap.delete(key);
    }

    const existing = await DB.prepare(
      'SELECT id, name, melee_guid FROM players WHERE LOWER(melee_name) = LOWER(?)'
    ).bind(username).first();
    if (existing) {
      const player = { id: existing.id, name: existing.name, melee_name: username, melee_guid: existing.melee_guid || null, active: 1 };
      playerMap.set(key, player);
      await refreshName(player, displayName, username);
      await captureAsmo(player, asmoConnectId, username);
      return existing.id;
    }

    const history = await DB.prepare(
      'SELECT player_id, melee_name FROM player_usernames WHERE name_lower = ?'
    ).bind(key).all();
    const matches = history.results || [];
    if (matches.length === 1) {
      const candidate = await DB.prepare('SELECT id, name, melee_guid FROM players WHERE id = ?')
        .bind(matches[0].player_id).first();
      const recycled = candidate && candidate.melee_guid && asmoConnectId
        && String(candidate.melee_guid) !== String(asmoConnectId);
      if (candidate && !recycled) {
        console.log(`[Finder] Username history ${username} → ${candidate.id}`);
        await DB.prepare('UPDATE player_usernames SET last_seen = ? WHERE player_id = ? AND name_lower = ?')
          .bind(new Date().toISOString(), matches[0].player_id, key).run();
        const player = {
          id: candidate.id,
          name: candidate.name ?? (displayName || username),
          melee_name: username,
          melee_guid: candidate.melee_guid || null,
          active: 1,
        };
        await captureAsmo(player, asmoConnectId, username);
        await refreshName(player, displayName, username);
        playerMap.set(key, player);
        return candidate.id;
      }
      if (recycled) {
        console.warn(`[Finder] Recycled username ${username}: history owner ${candidate.id} has AsmoConnectId ${candidate.melee_guid}, payload has ${asmoConnectId} — auto-creating`);
      }
    } else if (matches.length > 1) {
      console.warn(`[Finder] Ambiguous username history for ${username} (${matches.length} past owners) — auto-creating instead of guessing`);
    }

    return create(username, displayName, asmoConnectId);
  }

  function getMap() { return playerMap; }

  return { find, getMap };
}
