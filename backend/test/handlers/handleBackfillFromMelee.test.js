import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMockDb } from '../helpers/mock-db.js';
import { basicTables } from '../helpers/fixtures.js';
import { handleBackfillFromMelee } from '../../src/handlers/handleBackfillFromMelee.js';

describe('handleBackfillFromMelee', () => {
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
});
