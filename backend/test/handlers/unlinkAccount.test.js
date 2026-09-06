import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMockDb } from '../helpers/mock-db.js';
import { basicTables } from '../helpers/fixtures.js';
import { handleUnlinkAccount } from '../../src/handlers/unlinkAccount.js';

const aliceSession = { token: 'test-token-alice', player_id: 'P001', device_id: 'dev-alice', email: 'alice@test.com' };

describe('handleUnlinkAccount', () => {
  let DB;
  let env;

  beforeEach(() => {
    const tables = basicTables();
    DB = createMockDb(tables);
    env = { DB };
  });

  it('successful unlink returns success and playerName', async () => {
    const result = await handleUnlinkAccount({}, env, aliceSession);
    assert.equal(result.success, true);
    assert.equal(result.playerName, 'Alice');
  });

  it('sessions deleted from store', async () => {
    const store = DB.getStore();
    assert.ok(store.sessions.some((s) => s.token === 'test-token-alice'));

    await handleUnlinkAccount({}, env, aliceSession);

    assert.ok(!store.sessions.some((s) => s.token === 'test-token-alice'));
  });

  it('only deletes matching player+device sessions', async () => {
    const store = DB.getStore();
    assert.ok(store.sessions.some((s) => s.token === 'test-token-bob'));

    await handleUnlinkAccount({}, env, aliceSession);

    assert.ok(store.sessions.some((s) => s.token === 'test-token-bob'));
  });

  it('null session (bypassing router) → 401', async () => {
    await assert.rejects(
      () => handleUnlinkAccount({}, env, null),
      (err) => {
        assert.equal(err.status, 401);
        return true;
      }
    );
  });
});
