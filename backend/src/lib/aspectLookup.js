const FFG_CARDS_API = 'https://admin.starwarsunlimited.com/api/cards';
const LEADER_PAGE_SIZE = 100;
const LOOKUP_TIMEOUT_MS = 5000;
const SUGGESTION_MAX_DISTANCE = 2;
const BAD_ASPECTS = '\0bad';

export const SWU_ASPECTS = ['Aggression', 'Command', 'Cunning', 'Vigilance', 'Heroism', 'Villainy'];

const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const CANONICAL = new Map(SWU_ASPECTS.map((a) => [a.toLowerCase(), a]));

export function ffgLeadersUrl(setCode) {
  const code = String(setCode ?? '').trim().toUpperCase();
  const query = [
    `pagination[pageSize]=${LEADER_PAGE_SIZE}`,
    'filters[type][name][$eq]=Leader',
    `filters[expansion][code][$eq]=${encodeURIComponent(code)}`,
  ].join('&');
  return `${FFG_CARDS_API}?${query}`;
}

export function normalizeAspects(raw) {
  const list = Array.isArray(raw) ? raw : String(raw ?? '').split(',');
  const out = [];
  for (const item of list) {
    const name = CANONICAL.get(norm(item));
    if (name) out.push(name);
  }
  if (out.length === 0 || out.length > 2) return null;
  return out.join(',');
}

function aspectsOfRow(attrs) {
  const merged = [
    ...(attrs?.aspects?.data || []).map((x) => x?.attributes?.name),
    ...(attrs?.aspectDuplicates?.data || []).map((x) => x?.attributes?.name),
  ].filter((n) => n != null);
  return normalizeAspects(merged) ?? BAD_ASPECTS;
}

async function fetchJson(url) {
  try {
    const res = await globalThis.fetch(url, { signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) });
    if (!res || !res.ok) return null;
    return JSON.parse(await res.text());
  } catch {
    return null;
  }
}

function buildCandidates(rows) {
  const byTitle = new Map();
  for (const row of rows) {
    const attrs = row?.attributes;
    const title = String(attrs?.title ?? '').trim();
    if (!title) continue;
    const key = norm(title);
    if (!byTitle.has(key)) {
      byTitle.set(key, { name: title, values: new Set(), cardUid: attrs?.cardUid ?? null });
    }
    byTitle.get(key).values.add(aspectsOfRow(attrs));
  }
  const candidates = [];
  for (const entry of byTitle.values()) {
    const values = [...entry.values];
    const usable = values.find((v) => v !== BAD_ASPECTS) ?? null;
    candidates.push({ name: entry.name, aspects: usable, conflict: values.length > 1, cardUid: entry.cardUid });
  }
  return candidates;
}

export async function fetchSetLeaders(setCode) {
  const payload = await fetchJson(ffgLeadersUrl(setCode));
  const rows = Array.isArray(payload?.data) ? payload.data : null;
  if (!rows) return { error: 'unreachable' };
  const total = payload?.meta?.pagination?.total ?? rows.length;
  if (total > rows.length) return { error: 'incomplete' };
  return { candidates: buildCandidates(rows) };
}

function editDistanceWithin(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return Infinity;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return Infinity;
    prev = cur;
  }
  return prev[b.length];
}

export function matchLeader(candidates, name) {
  const target = norm(name);
  if (!target) return null;
  const list = candidates || [];
  for (const c of list) {
    if (norm(c.name) !== target) continue;
    if (c.conflict) return { suggestion: { name: c.name, aspects: c.aspects, cardUid: c.cardUid } };
    if (!c.aspects) return { badData: true };
    return { aspects: c.aspects };
  }
  let best = null;
  for (const c of list) {
    if (c.conflict || !c.aspects) continue;
    const d = editDistanceWithin(target, norm(c.name), SUGGESTION_MAX_DISTANCE);
    if (d > 0 && d <= SUGGESTION_MAX_DISTANCE && (!best || d < best.d)) best = { d, c };
  }
  if (best) {
    return { suggestion: { name: best.c.name, aspects: best.c.aspects, cardUid: best.c.cardUid } };
  }
  return null;
}
