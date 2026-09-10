import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMockDb } from '../helpers/mock-db.js';
import { basicTables, emptyTables } from '../helpers/fixtures.js';
import { handleSyncNow } from '../../src/handlers/syncNow.js';
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

describe('handleSyncNow', () => {
  it('runs sync immediately with admin token', async () => {
    const db = createMockDb(adminTables());
    const mockSync = async () => {};
    const result = await handleSyncNow(
      { adminToken: ADMIN_SECRET },
      { DB: db, ADMIN_SECRET, syncFromMelee: mockSync }
    );
    assert.equal(result.synced, true);
  });

  it('rejects missing admin token', async () => {
    const db = createMockDb(adminTables());
    await assert.rejects(
      () => handleSyncNow({}, { DB: db, ADMIN_SECRET }),
      (err) => {
        assert.equal(err.status, 403);
        return true;
      }
    );
  });

  it('rejects wrong admin token', async () => {
    const db = createMockDb(adminTables());
    await assert.rejects(
      () => handleSyncNow({ adminToken: 'wrong' }, { DB: db, ADMIN_SECRET }),
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
