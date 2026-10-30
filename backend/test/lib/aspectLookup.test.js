import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  SWU_ASPECTS,
  ffgLeadersUrl,
  normalizeAspects,
  fetchSetLeaders,
  matchLeader,
} from '../../src/lib/aspectLookup.js';

const ffgRow = (title, aspects, dups = [], cardUid = 777) => ({
  id: cardUid,
  attributes: {
    title,
    cardUid,
    aspects: { data: aspects.map((n) => ({ attributes: { name: n } })) },
    aspectDuplicates: { data: dups.map((n) => ({ attributes: { name: n } })) },
  },
});
const ffgBody = (rows, total = rows.length) =>
  JSON.stringify({ data: rows, meta: { pagination: { total } } });

describe('lib/aspectLookup (v4.19)', () => {
  let originalFetch;
  let calls;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    calls = [];
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function stubOnce(response) {
    globalThis.fetch = async (url) => {
      calls.push(url);
      if (response.throw) throw new Error('network down');
      return response;
    };
  }

  describe('ffgLeadersUrl', () => {
    it('builds the exact query shape verified against the live FFG API', () => {
      const decoded = decodeURIComponent(ffgLeadersUrl('JTL'));
      assert.ok(decoded.includes('pagination[pageSize]=100'));
      assert.ok(decoded.includes('filters[type][name][$eq]=Leader'));
      assert.ok(decoded.includes('filters[expansion][code][$eq]=JTL'));
      assert.ok(!decoded.includes('populate'), 'populate bracket syntax 400s on this API');
    });

    it('hostile set codes cannot escape the query value (SSRF pin)', () => {
      const hostile = ffgLeadersUrl('jtl&filters[a][b][$eq]=x/../..#zoom@evil');
      assert.ok(hostile.startsWith('https://admin.starwarsunlimited.com/api/cards?'));
      const value = hostile.split('code][$eq]=')[1];
      assert.ok(!value.includes('&'), 'no query injection');
      assert.ok(!value.includes('#'), 'no fragment injection');
      assert.ok(!value.includes('/'), 'no path escape');
      assert.ok(!value.includes('@'), 'no authority spoof');
      assert.ok(hostile.split('?').length === 2, 'exactly one query string');
    });
  });

  describe('normalizeAspects', () => {
    it('accepts arrays and comma strings, case-insensitive, canonical casing out', () => {
      assert.equal(normalizeAspects(['Villainy', 'Aggression']), 'Villainy,Aggression');
      assert.equal(normalizeAspects('heroism, command'), 'Heroism,Command');
      assert.equal(normalizeAspects('Command'), 'Command');
    });

    it('keeps intentional duplicates (DJ prints Cunning twice)', () => {
      assert.equal(normalizeAspects('Cunning,Cunning'), 'Cunning,Cunning');
    });

    it('drops unknowns; empty or more than two entries → null', () => {
      assert.equal(normalizeAspects(['Valor', 'Heroism']), 'Heroism');
      assert.equal(normalizeAspects('Valor,Honor'), null);
      assert.equal(normalizeAspects(''), null);
      assert.equal(normalizeAspects([]), null);
      assert.equal(normalizeAspects('Aggression,Command,Cunning'), null);
    });
  });

  describe('fetchSetLeaders', () => {
    it('one fetch per call; dedupes variant rows sharing a title', async () => {
      const rows = [];
      for (const uid of [1, 2, 3]) rows.push(ffgRow('Darth Vader', ['Command', 'Villainy'], [], uid));
      rows.push(ffgRow('Boba Fett', ['Aggression', 'Villainy'], [], 9));
      stubOnce({ ok: true, status: 200, text: async () => ffgBody(rows) });
      const res = await fetchSetLeaders('JTL');
      assert.equal(calls.length, 1);
      assert.equal(res.candidates.length, 2);
      const vader = res.candidates.find((c) => c.name === 'Darth Vader');
      assert.equal(vader.aspects, 'Command,Villainy');
      assert.equal(vader.conflict, false);
    });

    it('merges aspects + aspectDuplicates (DJ → Cunning,Cunning)', async () => {
      stubOnce({ ok: true, status: 200, text: async () => ffgBody([ffgRow('DJ', ['Cunning'], ['Cunning'])]) });
      const res = await fetchSetLeaders('SEC');
      assert.equal(res.candidates[0].aspects, 'Cunning,Cunning');
    });

    it('same title with conflicting aspects → candidate flagged, never auto-resolved', async () => {
      const rows = [
        ffgRow('Mystery Leader', ['Command'], [], 1),
        ffgRow('Mystery Leader', ['Cunning'], [], 2),
      ];
      stubOnce({ ok: true, status: 200, text: async () => ffgBody(rows) });
      const res = await fetchSetLeaders('JTL');
      assert.equal(res.candidates[0].conflict, true);
      const m = matchLeader(res.candidates, 'Mystery Leader');
      assert.ok(m.suggestion, 'conflicting titles surface as suggestion only');
      assert.equal(m.aspects, undefined);
    });

    it('pagination total larger than rows → incomplete sentinel (never silent NULL)', async () => {
      stubOnce({ ok: true, status: 200, text: async () => ffgBody([ffgRow('A', ['Command'])], 500) });
      const res = await fetchSetLeaders('JTL');
      assert.deepEqual(res, { error: 'incomplete' });
    });

    it('thrown fetch, !ok response and malformed JSON all → unreachable sentinel', async () => {
      stubOnce({ throw: true });
      assert.deepEqual(await fetchSetLeaders('JTL'), { error: 'unreachable' });
      stubOnce({ ok: false, status: 429, text: async () => '' });
      assert.deepEqual(await fetchSetLeaders('JTL'), { error: 'unreachable' });
      stubOnce({ ok: true, status: 200, text: async () => 'not json {{{' });
      assert.deepEqual(await fetchSetLeaders('JTL'), { error: 'unreachable' });
      assert.equal(calls.length, 3);
    });
  });

  describe('matchLeader', () => {
    const candidates = [
      { name: 'Enfy Nest', aspects: 'Aggression,Heroism', conflict: false, cardUid: 42 },
      { name: 'Darth Vader', aspects: 'Command,Villainy', conflict: false, cardUid: 7 },
    ];

    it('exact title match wins (case/whitespace insensitive)', () => {
      assert.deepEqual(matchLeader(candidates, 'darth   vader'), { aspects: 'Command,Villainy' });
    });

    it('typo within 2 edits surfaces the closest card as suggestion', () => {
      const m = matchLeader(candidates, 'Enfys Nest');
      assert.ok(m.suggestion);
      assert.equal(m.suggestion.name, 'Enfy Nest');
      assert.equal(m.suggestion.aspects, 'Aggression,Heroism');
      assert.equal(m.suggestion.cardUid, 42);
      assert.equal(m.aspects, undefined, 'suggestions are never auto-applied');
    });

    it('beyond 2 edits → null', () => {
      assert.equal(matchLeader(candidates, 'Grand Moff Tarkin'), null);
    });
  });

  it('exposes the six-aspect vocabulary', () => {
    assert.deepEqual(SWU_ASPECTS, ['Aggression', 'Command', 'Cunning', 'Vigilance', 'Heroism', 'Villainy']);
  });
});
