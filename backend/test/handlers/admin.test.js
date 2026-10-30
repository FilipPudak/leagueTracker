import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMockDb } from '../helpers/mock-db.js';
import { basicTables } from '../helpers/fixtures.js';
import { handleTriggerWeeklyCycle } from '../../src/handlers/triggerWeeklyCycle.js';
import { handlePauseSeason, handleResumeSeason } from '../../src/handlers/pauseSeason.js';
import { handleAddLeaders, handleSetLeadersActive, handleRemoveLeaders } from '../../src/handlers/leaderManagement.js';
import { handleMaterializePastAwards } from '../../src/handlers/materializePastAwards.js';

function adminTables() {
  const t = basicTables();
  t.settings = t.settings.map(s =>
    s.key === 'ACTIVE_SEASON_ID' ? { ...s, value: '6' } : s
  );
  return t;
}

const ADMIN_SECRET = 'test-admin-secret';

const ffgRow = (title, aspects, dups = [], cardUid = 777) => ({
  id: cardUid,
  attributes: {
    title,
    cardUid,
    aspects: { data: aspects.map((n) => ({ attributes: { name: n } })) },
    aspectDuplicates: { data: dups.map((n) => ({ attributes: { name: n } })) },
  },
});
function ffgOk(...rows) {
  return {
    ok: true, status: 200,
    text: async () => JSON.stringify({ data: rows, meta: { pagination: { total: rows.length } } }),
  };
}
function stubFfg(responses = {}) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const key = Object.keys(responses).find((k) => String(url).includes(k));
    if (!key) return ffgOk();
    const r = responses[key];
    if (r.throw) throw new Error('network down');
    return r;
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

describe('handleTriggerWeeklyCycle', () => {
  it('runs sync immediately with admin token', async () => {
    const db = createMockDb(adminTables());
    const mockSync = async () => {};
    const result = await handleTriggerWeeklyCycle(
      { adminToken: ADMIN_SECRET },
      { DB: db, ADMIN_SECRET, syncFromMelee: mockSync }
    );
    assert.equal(result.synced, true);
  });

  it('rejects missing admin token', async () => {
    const db = createMockDb(adminTables());
    await assert.rejects(
      () => handleTriggerWeeklyCycle({}, { DB: db, ADMIN_SECRET }),
      (err) => {
        assert.equal(err.status, 403);
        return true;
      }
    );
  });

  it('rejects wrong admin token', async () => {
    const db = createMockDb(adminTables());
    await assert.rejects(
      () => handleTriggerWeeklyCycle({ adminToken: 'wrong' }, { DB: db, ADMIN_SECRET }),
      (err) => {
        assert.equal(err.status, 403);
        return true;
      }
    );
  });
});

describe('handlePauseSeason', () => {
  it('sets SEASON_PAUSED to TRUE', async () => {
    const db = createMockDb(adminTables());
    await handlePauseSeason({ adminToken: ADMIN_SECRET }, { DB: db, ADMIN_SECRET });
    const store = db.getStore();
    const paused = store.settings.find(s => s.key === 'SEASON_PAUSED');
    assert.equal(paused?.value, 'TRUE');
  });

  it('rejects missing admin token', async () => {
    const db = createMockDb(adminTables());
    await assert.rejects(
      () => handlePauseSeason({}, { DB: db, ADMIN_SECRET }),
      (err) => {
        assert.equal(err.status, 403);
        return true;
      }
    );
  });
});

describe('handleResumeSeason', () => {
  it('sets SEASON_PAUSED to FALSE', async () => {
    const db = createMockDb(adminTables());
    db.getStore().settings.push({ key: 'SEASON_PAUSED', value: 'TRUE' });
    await handleResumeSeason({ adminToken: ADMIN_SECRET }, { DB: db, ADMIN_SECRET });
    const store = db.getStore();
    const paused = store.settings.find(s => s.key === 'SEASON_PAUSED');
    assert.equal(paused?.value, 'FALSE');
  });
});

describe('handleAddLeaders', () => {
  let suiteStub;
  beforeEach(() => { suiteStub = stubFfg({}); });
  afterEach(() => { suiteStub.restore(); });

  it('rejects missing admin token', async () => {
    const db = createMockDb(adminTables());
    await assert.rejects(
      () => handleAddLeaders({ leaders: [{ name: 'Yoda' }] }, { DB: db, ADMIN_SECRET }),
      (err) => { assert.equal(err.status, 403); return true; }
    );
  });

  it('rejects wrong admin token', async () => {
    const db = createMockDb(adminTables());
    await assert.rejects(
      () => handleAddLeaders({ adminToken: 'nope', leaders: [{ name: 'Yoda' }] }, { DB: db, ADMIN_SECRET }),
      (err) => { assert.equal(err.status, 403); return true; }
    );
  });

  it('adds new leaders with generated IDs', async () => {
    const db = createMockDb(adminTables());
    const result = await handleAddLeaders(
      { adminToken: ADMIN_SECRET, leaders: [{ name: 'Yoda', set: 'JTL' }] },
      { DB: db, ADMIN_SECRET }
    );
    assert.equal(result.added.length, 1);
    assert.equal(result.added[0].name, 'Yoda');
    const store = db.getStore();
    assert.ok(store.leaders.some(l => l.name === 'Yoda'));
  });

  it('deduplicates by name', async () => {
    const db = createMockDb(adminTables());
    await handleAddLeaders(
      { adminToken: ADMIN_SECRET, leaders: [{ name: 'Yoda', set: 'JTL' }] },
      { DB: db, ADMIN_SECRET }
    );
    const result = await handleAddLeaders(
      { adminToken: ADMIN_SECRET, leaders: [{ name: 'Yoda', set: 'JTL' }] },
      { DB: db, ADMIN_SECRET }
    );
    assert.equal(result.added.length, 0);
    assert.equal(result.skipped.length, 1);
  });

  it('same name with a different set is not a duplicate', async () => {
    const db = createMockDb(adminTables());
    await handleAddLeaders(
      { adminToken: ADMIN_SECRET, leaders: [{ name: 'Yoda', set: 'JTL' }] },
      { DB: db, ADMIN_SECRET }
    );
    const result = await handleAddLeaders(
      { adminToken: ADMIN_SECRET, leaders: [{ name: 'Yoda', set: 'HMW' }] },
      { DB: db, ADMIN_SECRET }
    );
    assert.equal(result.added.length, 1);
    assert.equal(result.skipped.length, 0);
    const store = db.getStore();
    const yodas = store.leaders.filter(l => l.name === 'Yoda');
    assert.equal(yodas.length, 2);
    assert.deepEqual(yodas.map(l => l.set).sort(), ['HMW', 'JTL']);
  });

  it('entry without a set still matches any existing same name', async () => {
    const db = createMockDb(adminTables());
    await handleAddLeaders(
      { adminToken: ADMIN_SECRET, leaders: [{ name: 'Yoda', set: 'JTL' }] },
      { DB: db, ADMIN_SECRET }
    );
    const result = await handleAddLeaders(
      { adminToken: ADMIN_SECRET, leaders: [{ name: 'Yoda' }] },
      { DB: db, ADMIN_SECRET }
    );
    assert.equal(result.added.length, 0);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.skipped[0].reason, 'duplicate');
  });

  it('rejects non-array leaders with 400', async () => {
    const db = createMockDb(adminTables());
    await assert.rejects(
      () => handleAddLeaders({ adminToken: ADMIN_SECRET, leaders: 'hello' }, { DB: db, ADMIN_SECRET }),
      (err) => { assert.equal(err.status, 400); assert.match(err.message, /array/); return true; }
    );
  });

  it('rejects null leaders with 400', async () => {
    const db = createMockDb(adminTables());
    await assert.rejects(
      () => handleAddLeaders({ adminToken: ADMIN_SECRET, leaders: null }, { DB: db, ADMIN_SECRET }),
      (err) => { assert.equal(err.status, 400); return true; }
    );
  });

  it('skips leaders with missing name', async () => {
    const db = createMockDb(adminTables());
    const result = await handleAddLeaders(
      { adminToken: ADMIN_SECRET, leaders: [{ set: 'JTL' }] },
      { DB: db, ADMIN_SECRET }
    );
    assert.equal(result.added.length, 0);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.skipped[0].reason, 'missing name');
  });

  it('resolves aspects via FFG lookup, one fetch per set per batch', async () => {
    const db = createMockDb(adminTables());
    const stub = stubFfg({ JTL: ffgOk(ffgRow('Yoda', ['Heroism', 'Vigilance'], [], 555)) });
    const result = await handleAddLeaders(
      { adminToken: ADMIN_SECRET, leaders: [{ name: 'Yoda', set: 'JTL' }, { name: 'Nobody Here', set: 'JTL' }] },
      { DB: db, ADMIN_SECRET }
    );
    stub.restore();
    const yoda = result.added.find((a) => a.name === 'Yoda');
    assert.equal(yoda.aspects, 'Heroism,Vigilance');
    assert.equal(yoda.aspectsResolved, true);
    const nobody = result.added.find((a) => a.name === 'Nobody Here');
    assert.equal(nobody.aspects, null);
    assert.equal(nobody.aspectsResolved, false);
    assert.equal(nobody.reason, 'no match');
    assert.equal(stub.calls.length, 1, 'same-set rows share one lookup');
    assert.equal(db.getStore().leaders.find((l) => l.name === 'Yoda').aspects, 'Heroism,Vigilance');
  });

  it('stores admin-provided aspects canonically without any lookup', async () => {
    const db = createMockDb(adminTables());
    const stub = stubFfg({});
    const result = await handleAddLeaders(
      { adminToken: ADMIN_SECRET, leaders: [{ name: 'Custom Leader', set: 'JTL', aspects: 'villainy,cunning' }] },
      { DB: db, ADMIN_SECRET }
    );
    stub.restore();
    assert.equal(result.added[0].aspects, 'Villainy,Cunning');
    assert.equal(result.added[0].aspectsResolved, true);
    assert.equal(stub.calls.length, 0);
  });

  it('refuses invalid admin-provided aspects without inserting', async () => {
    const db = createMockDb(adminTables());
    const result = await handleAddLeaders(
      { adminToken: ADMIN_SECRET, leaders: [{ name: 'Nope Leader', set: 'JTL', aspects: 'Valor,Honor' }] },
      { DB: db, ADMIN_SECRET }
    );
    assert.equal(result.added.length, 0);
    assert.equal(result.skipped[0].reason, 'invalid aspects');
    assert.equal(db.getStore().leaders.some((l) => l.name === 'Nope Leader'), false);
  });

  it('no set → NULL aspects with reason, no lookup attempted', async () => {
    const db = createMockDb(adminTables());
    const result = await handleAddLeaders(
      { adminToken: ADMIN_SECRET, leaders: [{ name: 'Homeless Leader' }] },
      { DB: db, ADMIN_SECRET }
    );
    assert.equal(result.added[0].aspects, null);
    assert.equal(result.added[0].aspectsResolved, false);
    assert.equal(result.added[0].reason, 'no set');
    assert.equal(db.getStore().leaders.find((l) => l.name === 'Homeless Leader').aspects, null);
  });

  it('FFG unreachable → import still succeeds with NULL aspects', async () => {
    const db = createMockDb(adminTables());
    const stub = stubFfg({ JTL: { throw: true } });
    const result = await handleAddLeaders(
      { adminToken: ADMIN_SECRET, leaders: [{ name: 'Yoda', set: 'JTL' }] },
      { DB: db, ADMIN_SECRET }
    );
    stub.restore();
    assert.equal(result.added.length, 1);
    assert.equal(result.added[0].aspects, null);
    assert.equal(result.added[0].aspectsResolved, false);
    assert.equal(result.added[0].reason, 'lookup failed');
    assert.equal(db.getStore().leaders.some((l) => l.name === 'Yoda'), true);
  });

  it('near-miss name surfaces a suggestion without auto-applying', async () => {
    const db = createMockDb(adminTables());
    const stub = stubFfg({ JTL: ffgOk(ffgRow('Enfy Nest', ['Aggression', 'Heroism'], [], 424)) });
    const result = await handleAddLeaders(
      { adminToken: ADMIN_SECRET, leaders: [{ name: 'Enfys Nest', set: 'JTL' }] },
      { DB: db, ADMIN_SECRET }
    );
    stub.restore();
    const row = result.added[0];
    assert.equal(row.aspects, null);
    assert.equal(row.reason, 'no match');
    assert.deepEqual(row.swuDbSuggestion, { name: 'Enfy Nest', aspects: 'Aggression,Heroism', cardUid: 424 });
    assert.equal(db.getStore().leaders.find((l) => l.name === 'Enfys Nest').aspects, null);
  });

  it('fill-gap: replay with aspects patches an existing NULL row, id preserved', async () => {
    const db = createMockDb(adminTables());
    const first = await handleAddLeaders(
      { adminToken: ADMIN_SECRET, leaders: [{ name: 'Yoda', set: 'JTL' }] },
      { DB: db, ADMIN_SECRET }
    );
    const second = await handleAddLeaders(
      { adminToken: ADMIN_SECRET, leaders: [{ name: 'Yoda', set: 'JTL', aspects: 'Heroism,Vigilance' }] },
      { DB: db, ADMIN_SECRET }
    );
    assert.equal(second.added.length, 0);
    assert.equal(second.skipped.length, 0);
    assert.equal(second.filled.length, 1);
    assert.equal(second.filled[0].id, first.added[0].id);
    assert.equal(second.filled[0].aspects, 'Heroism,Vigilance');
    assert.equal(db.getStore().leaders.filter((l) => l.name === 'Yoda').length, 1);
    assert.equal(db.getStore().leaders.find((l) => l.name === 'Yoda').aspects, 'Heroism,Vigilance');
  });

  it('fill-gap never overwrites non-NULL aspects', async () => {
    const db = createMockDb(adminTables());
    const result = await handleAddLeaders(
      { adminToken: ADMIN_SECRET, leaders: [{ name: 'Darth Vader', set: 'JTL', aspects: 'Aggression,Cunning' }] },
      { DB: db, ADMIN_SECRET }
    );
    assert.equal(result.filled.length, 0);
    assert.equal(result.skipped[0].reason, 'duplicate');
    assert.equal(db.getStore().leaders.find((l) => l.name === 'Darth Vader').aspects, 'Command,Villainy');
  });

  it('summary lets a script check batch success at a glance', async () => {
    const db = createMockDb(adminTables());
    const stub = stubFfg({ JTL: ffgOk(ffgRow('Yoda', ['Heroism', 'Vigilance'], [], 555)) });
    const result = await handleAddLeaders(
      { adminToken: ADMIN_SECRET, leaders: [
        { name: 'Yoda', set: 'JTL' },
        { name: 'Yoda', set: 'JTL' },
        { name: 'Ghost Leader', set: 'JTL' },
        { name: 'Bad One', set: 'JTL', aspects: 'Valor' },
        { name: 'NoSet One' },
      ] },
      { DB: db, ADMIN_SECRET }
    );
    stub.restore();
    assert.deepEqual(result.summary, { requested: 5, added: 3, skipped: 2, filled: 0, unresolved: 2 });
  });

  it('summary reports a fully clean batch', async () => {
    const db = createMockDb(adminTables());
    const stub = stubFfg({ JTL: ffgOk(ffgRow('Yoda', ['Heroism', 'Vigilance'], [], 555)) });
    const result = await handleAddLeaders(
      { adminToken: ADMIN_SECRET, leaders: [{ name: 'Yoda', set: 'JTL' }] },
      { DB: db, ADMIN_SECRET }
    );
    stub.restore();
    assert.deepEqual(result.summary, { requested: 1, added: 1, skipped: 0, filled: 0, unresolved: 0 });
  });
});

describe('handleSetLeadersActive', () => {
  it('rejects missing admin token', async () => {
    const db = createMockDb(adminTables());
    await assert.rejects(
      () => handleSetLeadersActive({ leaderIds: ['1'], active: 0 }, { DB: db, ADMIN_SECRET }),
      (err) => { assert.equal(err.status, 403); return true; }
    );
  });

  it('sets active status for leaders', async () => {
    const db = createMockDb(adminTables());
    await handleSetLeadersActive(
      { adminToken: ADMIN_SECRET, leaderIds: ['1', '2'], active: 0 },
      { DB: db, ADMIN_SECRET }
    );
    const store = db.getStore();
    assert.equal(store.leaders.find(l => l.id === '1').active, 0);
    assert.equal(store.leaders.find(l => l.id === '2').active, 0);
  });

  it('rejects non-array leaderIds with 400', async () => {
    const db = createMockDb(adminTables());
    await assert.rejects(
      () => handleSetLeadersActive({ adminToken: ADMIN_SECRET, leaderIds: 'hello', active: 0 }, { DB: db, ADMIN_SECRET }),
      (err) => { assert.equal(err.status, 400); return true; }
    );
  });

  it('rejects undefined leaderIds with 400', async () => {
    const db = createMockDb(adminTables());
    await assert.rejects(
      () => handleSetLeadersActive({ adminToken: ADMIN_SECRET, active: 0 }, { DB: db, ADMIN_SECRET }),
      (err) => { assert.equal(err.status, 400); return true; }
    );
  });
});

describe('handleRemoveLeaders', () => {
  it('rejects wrong admin token', async () => {
    const db = createMockDb(adminTables());
    await assert.rejects(
      () => handleRemoveLeaders({ adminToken: 'nope', leaderIds: ['4'] }, { DB: db, ADMIN_SECRET }),
      (err) => { assert.equal(err.status, 403); return true; }
    );
  });

  it('removes leaders not referenced by votes', async () => {
    const db = createMockDb(adminTables());
    const result = await handleRemoveLeaders(
      { adminToken: ADMIN_SECRET, leaderIds: ['4'] },
      { DB: db, ADMIN_SECRET }
    );
    assert.equal(result.removed.length, 1);
    const store = db.getStore();
    assert.ok(!store.leaders.some(l => l.id === '4'));
  });

  it('refuses to remove leaders referenced by votes', async () => {
    const db = createMockDb(adminTables());
    const result = await handleRemoveLeaders(
      { adminToken: ADMIN_SECRET, leaderIds: ['1'] },
      { DB: db, ADMIN_SECRET }
    );
    assert.equal(result.removed.length, 0);
    assert.ok(result.refused.length > 0);
  });

  it('rejects non-array leaderIds with 400', async () => {
    const db = createMockDb(adminTables());
    await assert.rejects(
      () => handleRemoveLeaders({ adminToken: ADMIN_SECRET, leaderIds: 'hello' }, { DB: db, ADMIN_SECRET }),
      (err) => { assert.equal(err.status, 400); return true; }
    );
  });
});

describe('handleMaterializePastAwards', () => {
  it('rejects missing admin token', async () => {
    const db = createMockDb(adminTables());
    await assert.rejects(
      () => handleMaterializePastAwards({ seasonId: 5 }, { DB: db, ADMIN_SECRET }),
      (err) => { assert.equal(err.status, 403); return true; }
    );
  });

  it('computes awards for past seasons (S1-S5)', async () => {
    const tables = adminTables();
    tables.seasons = [
      { id: 5, name: 'Season 5', created_date: '2026-01-15', length: 11, top_results: 7 },
      { id: 6, name: 'Season 6', created_date: '2026-06-03', length: 11, top_results: 7 },
    ];
    const db = createMockDb(tables);
    const result = await handleMaterializePastAwards(
      { adminToken: ADMIN_SECRET, seasonId: 5, dryRun: true },
      { DB: db, ADMIN_SECRET }
    );
    assert.ok(result.podiums);
    assert.ok(result.podiums['Galactic Ruler'] !== undefined);
  });

  it('refuses to materialize awards for S6+', async () => {
    const db = createMockDb(adminTables());
    await assert.rejects(
      () => handleMaterializePastAwards(
        { adminToken: ADMIN_SECRET, seasonId: 6, dryRun: true },
        { DB: db, ADMIN_SECRET }
      ),
      (err) => {
        assert.ok(err.message.includes('S1-S5'));
        return true;
      }
    );
  });

  it('rejects unparseable seasonId with 400', async () => {
    const db = createMockDb(adminTables());
    await assert.rejects(
      () => handleMaterializePastAwards(
        { adminToken: ADMIN_SECRET, seasonId: 'banana', dryRun: true },
        { DB: db, ADMIN_SECRET }
      ),
      (err) => { assert.equal(err.status, 400); return true; }
    );
  });

  it('normalizes prefixed string seasonId "S5" (was string-comparable against guard)', async () => {
    const tables = adminTables();
    tables.seasons = [
      { id: 5, name: 'Season 5', created_date: '2026-01-15', length: 11, top_results: 7 },
      { id: 6, name: 'Season 6', created_date: '2026-06-03', length: 11, top_results: 7 },
    ];
    const db = createMockDb(tables);
    const result = await handleMaterializePastAwards(
      { adminToken: ADMIN_SECRET, seasonId: 'S5', dryRun: true },
      { DB: db, ADMIN_SECRET }
    );
    assert.ok(result.podiums, 'S5 string form parses to season 5 and passes the guard');
  });

  it('refuses to materialize awards for S1 when no previous season', async () => {
    const tables = adminTables();
    tables.seasons = [
      { id: 1, name: 'Season 1', created_date: '2025-01-01', length: 10, top_results: 7 },
    ];
    const db = createMockDb(tables);
    const result = await handleMaterializePastAwards(
      { adminToken: ADMIN_SECRET, seasonId: 1, dryRun: true },
      { DB: db, ADMIN_SECRET }
    );
    assert.ok(result.podiums['Bounty Hunter'].length === 0);
  });

  it('writes awards when dryRun is false', async () => {
    const tables = adminTables();
    tables.seasons = [
      { id: 5, name: 'Season 5', created_date: '2026-01-15', length: 11, top_results: 7 },
      { id: 6, name: 'Season 6', created_date: '2026-06-03', length: 11, top_results: 7 },
    ];
    tables.melee_tournaments = [
      { melee_id: 100, season_id: 5, round: 1, name: 'SWU Wednesday league season 5 01/01 (week 1)', date: '2026-01-01', phase: 'regular' },
    ];
    tables.season_standings = [
      { season_id: 5, round: 1, player_id: 'P001', wins: 3, losses: 0, draws: 0, match_points: 9, rank: 1 },
      { season_id: 5, round: 1, player_id: 'P002', wins: 2, losses: 1, draws: 0, match_points: 6, rank: 2 },
    ];
    const db = createMockDb(tables);
    await handleMaterializePastAwards(
      { adminToken: ADMIN_SECRET, seasonId: 5, dryRun: false },
      { DB: db, ADMIN_SECRET }
    );
    const store = db.getStore();
    assert.ok(store.awards.some(a => a.season_id === 5));
  });
});
