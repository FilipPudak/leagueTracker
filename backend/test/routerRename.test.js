import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMockDb } from './helpers/mock-db.js';
import { basicTables } from './helpers/fixtures.js';

const mod = await import('../src/index.js');
const worker = mod.default;

const ADMIN_SECRET = 'test-secret-123';

function env() {
  return { DB: createMockDb(basicTables()), ADMIN_SECRET };
}

function post(body) {
  return new Request('https://example.com', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('router – rename actions', () => {
  it('requestRename without a session → 401', async () => {
    const resp = await worker.fetch(post({ action: 'requestRename', newMeleeName: 'alice_two' }), env());
    assert.equal(resp.status, 401);
  });

  it('requestRename with a valid session → 200 pending', async () => {
    const resp = await worker.fetch(
      post({ action: 'requestRename', token: 'test-token-alice', newMeleeName: 'alice_two' }),
      env()
    );
    assert.equal(resp.status, 200);
    const json = await resp.json();
    assert.equal(json.success, true);
    assert.equal(json.data.status, 'pending');
    assert.equal(json.data.newMeleeName, 'alice_two');
  });

  it('listRenameRequests without adminToken → 403', async () => {
    const resp = await worker.fetch(post({ action: 'listRenameRequests' }), env());
    assert.equal(resp.status, 403);
  });

  it('listRenameRequests with adminToken → 200 queue', async () => {
    const resp = await worker.fetch(post({ action: 'listRenameRequests', adminToken: ADMIN_SECRET }), env());
    assert.equal(resp.status, 200);
    const json = await resp.json();
    assert.ok(Array.isArray(json.data.requests));
  });

  it('approveRename without adminToken → 403', async () => {
    const resp = await worker.fetch(
      post({ action: 'approveRename', playerId: 'P002', newMeleeName: 'bob_two' }),
      env()
    );
    assert.equal(resp.status, 403);
  });

  it('approveRename with adminToken (admin-direct form) → 200 approved', async () => {
    const resp = await worker.fetch(
      post({ action: 'approveRename', adminToken: ADMIN_SECRET, playerId: 'P002', newMeleeName: 'bob_two' }),
      env()
    );
    assert.equal(resp.status, 200);
    const json = await resp.json();
    assert.equal(json.data.status, 'approved');
    assert.equal(json.data.newMeleeName, 'bob_two');
  });

  it('rejectRename without adminToken → 403', async () => {
    const resp = await worker.fetch(post({ action: 'rejectRename', requestId: 1 }), env());
    assert.equal(resp.status, 403);
  });

  it('mergePlayers without adminToken → 403', async () => {
    const resp = await worker.fetch(
      post({ action: 'mergePlayers', survivorId: 'P001', orphanId: 'P004' }),
      env()
    );
    assert.equal(resp.status, 403);
  });

  it('mergePlayers with adminToken → 200 merged', async () => {
    const testEnv = env();
    const resp = await worker.fetch(
      post({ action: 'mergePlayers', adminToken: ADMIN_SECRET, survivorId: 'P001', orphanId: 'P004' }),
      testEnv
    );
    assert.equal(resp.status, 200);
    const json = await resp.json();
    assert.equal(json.data.orphanId, 'P004');
    assert.ok(!testEnv.DB.getStore().players.some(p => p.id === 'P004'), 'orphan row deleted');
  });
});
