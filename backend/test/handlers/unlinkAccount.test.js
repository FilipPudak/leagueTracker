import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMockDb } from '../helpers/mock-db.js';
import { basicTables } from '../helpers/fixtures.js';
import { handleUnlinkAccount } from '../../src/handlers/unlinkAccount.js';

describe('handleUnlinkAccount', () => {
  let DB;
  let env;

  beforeEach(() => {
    const tables = basicTables();
    DB = createMockDb(tables);
    env = { DB };
  });

  it('successful unlink returns success and playerName', async () => {
    const result = await handleUnlinkAccount({ token: 'test-token-alice' }, env);
    assert.equal(result.success, true);
    assert.equal(result.playerName, 'Alice');
  });

  it('missing token → 400', async () => {
    await assert.rejects(
      () => handleUnlinkAccount({}, env),
      (err) => {
        assert.equal(err.status, 400);
        return true;
      }
    );
  });

  it('session not found → 404', async () => {
    await assert.rejects(
      () => handleUnlinkAccount({ token: 'nonexistent-token' }, env),
      (err) => {
        assert.equal(err.status, 404);
        return true;
      }
    );
  });

  it('sessions deleted from store', async () => {
    const store = DB.getStore();
    assert.ok(store.sessions.some((s) => s.token === 'test-token-alice'));

    await handleUnlinkAccount({ token: 'test-token-alice' }, env);

    assert.ok(!store.sessions.some((s) => s.token === 'test-token-alice'));
  });

  it('only deletes matching player+device sessions', async () => {
    const store = DB.getStore();
    assert.ok(store.sessions.some((s) => s.token === 'test-token-bob'));

    await handleUnlinkAccount({ token: 'test-token-alice' }, env);

    assert.ok(store.sessions.some((s) => s.token === 'test-token-bob'));
  });
});
