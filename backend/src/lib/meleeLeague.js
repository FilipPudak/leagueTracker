const LEAGUE_REGEX = /^SWU Wednesday league(?: season (\d+))?(?:\s+\d{1,2}\/\d{1,2}|\s+(?:top [48]|best of the rest|playoff|championship|finale))/i;
const EXCLUDED_KEYWORDS = ['prerelease', 'draft', 'clone', 'budget draft'];

const PHASE_ORDER = { cut: 0, regular: 1, side: 2 };

export function classifyPhase(name) {
  const lower = name.toLowerCase();
  if (/best of the rest|finale/i.test(lower)) return 'side';
  if (/top [48]|playoff|championship/i.test(lower)) return 'cut';
  return 'regular';
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
    let response;
    try {
      response = await client.listTournaments(null, page, pageSize);
    } catch (err) {
      console.error(`[meleeLeague] Failed to list tournaments: ${err.message}`);
      break;
    }

    const content = response.Content || [];
    for (const t of content) {
      if (!isLeagueTournament(t.Name)) continue;
      const info = extractSeasonAndRound(t.Name);
      if (!info) continue;
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

  const regulars = [];
  const specials = [];
  for (const t of tournaments) {
    const phase = t.phase || classifyPhase(t.Name);
    if (phase === 'regular') regulars.push(t);
    else specials.push(t);
  }

  let seq = 1;
  for (const t of regulars) {
    const existingRound = existingRoundMap.get(t.ID);
    const round = existingRound != null ? existingRound : seq++;
    weekMap.set(t.ID, {
      meleeId: t.ID,
      round,
      name: t.Name,
      date: t.StartDate || t.LastPairDateTime || null,
      phase: 'regular',
    });
  }

  let specialSeq = seq;
  for (const t of specials) {
    const existingRound = existingRoundMap.get(t.ID);
    const round = existingRound != null ? existingRound : specialSeq++;
    const phase = t.phase || classifyPhase(t.Name);
    weekMap.set(t.ID, {
      meleeId: t.ID,
      round,
      name: t.Name,
      date: t.StartDate || t.LastPairDateTime || null,
      phase,
    });
  }

  return weekMap;
}

export function createPlayerFinder(DB) {
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
    nextPlayerNum = allPlayers.reduce((max, p) => {
      const m = p.id?.match(/^P(\d+)$/);
      return m ? Math.max(max, parseInt(m[1], 10)) : max;
    }, 0) + 1;
    initialized = true;
  }

  async function find(username, displayName) {
    await init();
    const key = username.toLowerCase();

    if (playerMap.has(key)) {
      const cached = playerMap.get(key);
      const dbCheck = await DB.prepare('SELECT id FROM players WHERE id = ?').bind(cached.id).first();
      if (dbCheck) return cached.id;
      playerMap.delete(key);
    }

    const existing = await DB.prepare('SELECT id FROM players WHERE melee_name = ?').bind(username).first();
    if (existing) {
      const player = { id: existing.id, name: displayName || username, melee_name: username, active: 1 };
      playerMap.set(key, player);
      return existing.id;
    }

    const id = `P${String(nextPlayerNum++).padStart(3, '0')}`;
    const name = displayName || username;
    await DB.prepare('INSERT INTO players (id, name, melee_name, active) VALUES (?, ?, ?, 1)')
      .bind(id, name, username).run();
    const player = { id, name, melee_name: username, active: 1 };
    playerMap.set(key, player);
    return id;
  }

  function getMap() { return playerMap; }

  return { find, getMap };
}
