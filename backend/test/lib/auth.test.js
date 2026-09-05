import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetCryptoCounter } from '../helpers/mock-crypto.js';
import { createMockDb } from '../helpers/mock-db.js';
import { basicTables, emptyTables } from '../helpers/fixtures.js';
import {
  findSessionByToken,
  findSessionByPlayerAndDevice,
  touchSessionTimestamp,
  createSession,
  deleteSessionsByPlayerAndDevice,
} from '../../src/lib/auth.js';

function mockCrypto() {
  let counter = 0;
  const original = globalThis.crypto.randomUUID;
  globalThis.crypto.randomUUID = () => {
    counter++;
    return `test-uuid-${String(counter).padStart(3, '0')}`;
  };
  return {
    restore() {
      globalThis.crypto.randomUUID = original;
    },
  };
}

describe('findSessionByToken', () => {
  it('returns session row for valid token', async () => {
    const db = createMockDb(basicTables());
    const session = await findSessionByToken(db, 'test-token-alice');
    assert.equal(session.token, 'test-token-alice');
    assert.equal(session.player_id, 'P001');
    assert.equal(session.device_id, 'dev-alice');
    assert.equal(session.email, 'alice@test.com');
  });

  it('returns null for expired token and deletes it', async () => {
    const db = createMockDb(basicTables());
    const session = await findSessionByToken(db, 'test-token-expired');
    assert.equal(session, null);
    const store = db.getStore();
    const deleted = store.sessions.find(s => s.token === 'test-token-expired');
    assert.equal(deleted, undefined);
  });

  it('returns null for null token', async () => {
    const db = createMockDb(basicTables());
    const session = await findSessionByToken(db, null);
    assert.equal(session, null);
  });

  it('returns null for non-existent token', async () => {
    const db = createMockDb(basicTables());
    const session = await findSessionByToken(db, 'non-existent-token');
    assert.equal(session, null);
  });

  it('returns null for empty string token', async () => {
    const db = createMockDb(basicTables());
    const session = await findSessionByToken(db, '');
    assert.equal(session, null);
  });
});

describe('findSessionByPlayerAndDevice', () => {
  it('returns session for valid player and device', async () => {
    const db = createMockDb(basicTables());
    const session = await findSessionByPlayerAndDevice(db, 'P001', 'dev-alice');
    assert.equal(session.token, 'test-token-alice');
    assert.equal(session.player_id, 'P001');
    assert.equal(session.device_id, 'dev-alice');
  });

  it('returns null for expired session and deletes it', async () => {
    const db = createMockDb(basicTables());
    const session = await findSessionByPlayerAndDevice(db, 'P003', 'dev-charlie');
    assert.equal(session, null);
    const store = db.getStore();
    const deleted = store.sessions.find(s => s.token === 'test-token-expired');
    assert.equal(deleted, undefined);
  });

  it('returns null for non-existent player', async () => {
    const db = createMockDb(basicTables());
    const session = await findSessionByPlayerAndDevice(db, 'P999', 'dev-alice');
    assert.equal(session, null);
  });

  it('returns null for non-existent device', async () => {
    const db = createMockDb(basicTables());
    const session = await findSessionByPlayerAndDevice(db, 'P001', 'dev-nonexistent');
    assert.equal(session, null);
  });
});

describe('touchSessionTimestamp', () => {
  it('issues UPDATE query for the token', async () => {
    const db = createMockDb(basicTables());
    await touchSessionTimestamp(db, 'test-token-alice');
    const calls = db.getCalls();
    const updateCall = calls.find(c => c.sql.toUpperCase().includes('UPDATE') && c.sql.includes('sessions'));
    assert.ok(updateCall);
    assert.deepEqual(updateCall.params, ['test-token-alice']);
  });

  it('does not throw for non-existent token', async () => {
    const db = createMockDb(basicTables());
    await assert.doesNotReject(() => touchSessionTimestamp(db, 'non-existent'));
  });
});

describe('createSession', () => {
  let cryptoMock;

  beforeEach(() => {
    resetCryptoCounter();
    cryptoMock = mockCrypto();
  });

  afterEach(() => {
    cryptoMock.restore();
  });

  it('generates UUID token and inserts session', async () => {
    const db = createMockDb(basicTables());
    const token = await createSession(db, 'P004', 'dev-diana', 'diana@test.com');
    assert.equal(token, 'test-uuid-001');
    const store = db.getStore();
    const session = store.sessions.find(s => s.token === 'test-uuid-001');
    assert.ok(session);
    assert.equal(session.player_id, 'P004');
    assert.equal(session.device_id, 'dev-diana');
    assert.equal(session.email, 'diana@test.com');
  });

  it('sets created and last_active timestamps', async () => {
    const db = createMockDb(basicTables());
    await createSession(db, 'P004', 'dev-diana', 'diana@test.com');
    const store = db.getStore();
    const session = store.sessions.find(s => s.token === 'test-uuid-001');
    assert.ok(session.created);
    assert.ok(session.last_active);
    assert.equal(session.created, session.last_active);
  });

  it('defaults email to empty string when not provided', async () => {
    const db = createMockDb(basicTables());
    const token = await createSession(db, 'P004', 'dev-diana');
    const store = db.getStore();
    const session = store.sessions.find(s => s.token === token);
    assert.equal(session.email, '');
  });

  it('increments UUID counter across calls', async () => {
    const db = createMockDb(basicTables());
    const token1 = await createSession(db, 'P001', 'dev1', 'a@test.com');
    const token2 = await createSession(db, 'P002', 'dev2', 'b@test.com');
    assert.equal(token1, 'test-uuid-001');
    assert.equal(token2, 'test-uuid-002');
  });

  it('issues INSERT query to DB', async () => {
    const db = createMockDb(basicTables());
    db.clearCalls();
    await createSession(db, 'P004', 'dev-diana', 'diana@test.com');
    const calls = db.getCalls();
    const insertCall = calls.find(c => c.sql.toUpperCase().includes('INSERT'));
    assert.ok(insertCall);
    assert.ok(insertCall.sql.includes('sessions'));
  });
});

describe('deleteSessionsByPlayerAndDevice', () => {
  it('deletes matching sessions from DB', async () => {
    const db = createMockDb(basicTables());
    await deleteSessionsByPlayerAndDevice(db, 'P001', 'dev-alice');
    const store = db.getStore();
    const remaining = store.sessions.filter(
      s => s.player_id === 'P001' && s.device_id === 'dev-alice'
    );
    assert.equal(remaining.length, 0);
  });

  it('does not delete sessions for other players', async () => {
    const db = createMockDb(basicTables());
    await deleteSessionsByPlayerAndDevice(db, 'P001', 'dev-alice');
    const store = db.getStore();
    const bobSession = store.sessions.find(s => s.token === 'test-token-bob');
    assert.ok(bobSession);
  });

  it('does not throw for non-existent player', async () => {
    const db = createMockDb(basicTables());
    await assert.doesNotReject(() =>
      deleteSessionsByPlayerAndDevice(db, 'P999', 'dev-nonexistent')
    );
  });

  it('issues DELETE query to DB', async () => {
    const db = createMockDb(basicTables());
    db.clearCalls();
    await deleteSessionsByPlayerAndDevice(db, 'P001', 'dev-alice');
    const calls = db.getCalls();
    const deleteCall = calls.find(c => c.sql.toUpperCase().startsWith('DELETE'));
    assert.ok(deleteCall);
    assert.ok(deleteCall.sql.includes('sessions'));
    assert.deepEqual(deleteCall.params, ['P001', 'dev-alice']);
  });
});
