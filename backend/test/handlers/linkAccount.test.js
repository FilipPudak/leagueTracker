import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMockDb } from '../helpers/mock-db.js';
import { basicTables } from '../helpers/fixtures.js';
import { installCryptoMock } from '../helpers/mock-crypto.js';
import { handleLinkAccount } from '../../src/handlers/linkAccount.js';

describe('handleLinkAccount', () => {
  let DB;
  let env;

  beforeEach(() => {
    installCryptoMock();
    const tables = basicTables();
    DB = createMockDb(tables);
    env = { DB };
  });

  it('fresh link creates session and returns token', async () => {
    const result = await handleLinkAccount(
      { playerId: 'P001', email: 'newalice@test.com', deviceId: 'dev-new' },
      env
    );
    assert.ok(result.token);
    assert.equal(typeof result.token, 'string');
    assert.equal(result.linkedPlayer.id, 'P001');
    assert.equal(result.linkedPlayer.email, 'newalice@test.com');
  });

  it('relink same device reuses token', async () => {
    const result1 = await handleLinkAccount(
      { playerId: 'P001', email: 'alice@test.com', deviceId: 'dev-alice' },
      env
    );
    assert.equal(result1.token, 'test-token-alice');
  });

  it('missing playerId → 400', async () => {
    await assert.rejects(
      () => handleLinkAccount({ email: 'test@test.com', deviceId: 'dev' }, env),
      (err) => {
        assert.equal(err.status, 400);
        return true;
      }
    );
  });

  it('invalid email → 400', async () => {
    await assert.rejects(
      () => handleLinkAccount({ playerId: 'P001', email: 'not-an-email', deviceId: 'dev' }, env),
      (err) => {
        assert.equal(err.status, 400);
        return true;
      }
    );
  });

  it('missing email → 400', async () => {
    await assert.rejects(
      () => handleLinkAccount({ playerId: 'P001', deviceId: 'dev' }, env),
      (err) => {
        assert.equal(err.status, 400);
        return true;
      }
    );
  });

  it('player not found → 404', async () => {
    await assert.rejects(
      () =>
        handleLinkAccount(
          { playerId: 'P999', email: 'nobody@test.com', deviceId: 'dev' },
          env
        ),
      (err) => {
        assert.equal(err.status, 404);
        return true;
      }
    );
  });

  it('email already linked to different player → 409', async () => {
    await assert.rejects(
      () =>
        handleLinkAccount(
          { playerId: 'P002', email: 'alice@test.com', deviceId: 'dev' },
          env
        ),
      (err) => {
        assert.equal(err.status, 409);
        return true;
      }
    );
  });

  it('returns leaders, players, seasons, votingOpen', async () => {
    const result = await handleLinkAccount(
      { playerId: 'P001', email: 'alice@test.com', deviceId: 'dev-new' },
      env
    );
    assert.ok(Array.isArray(result.leaders));
    assert.ok(result.leaders.length >= 3);
    assert.ok(result.leaders[0].id);
    assert.ok(result.leaders[0].name);
    assert.ok(Array.isArray(result.players));
    assert.ok(result.players.length >= 4);
    assert.ok(Array.isArray(result.seasons));
    assert.ok(result.seasons.length >= 2);
    assert.equal(typeof result.votingOpen, 'boolean');
  });
});
