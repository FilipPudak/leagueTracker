import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMockDb } from '../helpers/mock-db.js';
import { basicTables } from '../helpers/fixtures.js';
import { handleBackfillFromMelee } from '../../src/handlers/backfillFromMelee.js';

describe('handleBackfillFromMelee (admin wrapper)', () => {
  let DB;
  let env;

  beforeEach(() => {
    const tables = basicTables();
    DB = createMockDb(tables);
    env = { DB, ADMIN_SECRET: 'test-secret-123' };
  });

  it('missing adminToken → 403', async () => {
    await assert.rejects(
      () => handleBackfillFromMelee({}, env),
      (err) => {
        assert.equal(err.status, 403);
        assert.match(err.message, /Unauthorized/i);
        return true;
      }
    );
  });

  it('wrong adminToken → 403', async () => {
    await assert.rejects(
      () => handleBackfillFromMelee({ adminToken: 'wrong-token' }, env),
      (err) => {
        assert.equal(err.status, 403);
        return true;
      }
    );
  });

  it('valid adminToken → delegates to backfillFromMelee and returns result', async () => {
    const result = await handleBackfillFromMelee(
      { adminToken: 'test-secret-123' },
      env
    );
    assert.equal(typeof result.tournaments, 'number');
    assert.equal(typeof result.standings, 'number');
    assert.equal(typeof result.matches, 'number');
  });

  it('seasonId passed through correctly', async () => {
    const result = await handleBackfillFromMelee(
      { adminToken: 'test-secret-123', seasonId: 5 },
      env
    );
    assert.equal(result.seasonId, 5);
  });

  it('T4.14 passes allowActiveSeason through to the trigger', async () => {
    const tables = basicTables();
    tables.settings = [...tables.settings, { key: 'SEASON_STARTED', value: 'TRUE' }];
    env = { DB: createMockDb(tables), ADMIN_SECRET: 'test-secret-123' };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify({ Content: [], TotalCount: 0 }),
    });
    try {
      const refused = await handleBackfillFromMelee(
        { adminToken: 'test-secret-123', seasonId: 6 },
        env
      );
      assert.equal(refused.refused, true, 'live active season refused without the flag');

      const allowed = await handleBackfillFromMelee(
        { adminToken: 'test-secret-123', seasonId: 6, allowActiveSeason: true },
        env
      );
      assert.ok(!allowed.refused, 'flag lets the active season through');
      assert.equal(allowed.seasonId, 6);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
