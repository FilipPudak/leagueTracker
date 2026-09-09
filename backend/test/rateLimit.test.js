import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMockDb } from './helpers/mock-db.js';
import { basicTables } from './helpers/fixtures.js';

const realNow = Date.now();
let fakeNow = realNow;
Date.now = () => fakeNow;

const mod = await import('../src/index.js');
const worker = mod.default;

function env() {
  return { DB: createMockDb(basicTables()) };
}

function post(body, ip) {
  return new Request('https://example.com', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': ip },
  });
}

describe('rate limiter: per-action classes', () => {
  afterEach(() => {
    fakeNow = realNow;
  });

  it('reads get a 90/min budget and recover after the window', async () => {
    const testEnv = env();
    for (let i = 0; i < 90; i++) {
      const resp = await worker.fetch(post({ action: 'getAppData' }, '10.0.0.1'), testEnv);
      assert.equal(resp.status, 200, `read ${i + 1} within limit`);
    }
    const blocked = await worker.fetch(post({ action: 'getAppData' }, '10.0.0.1'), testEnv);
    assert.equal(blocked.status, 429);

    fakeNow += 61_000;
    const recovered = await worker.fetch(post({ action: 'getAppData' }, '10.0.0.1'), testEnv);
    assert.equal(recovered.status, 200, 'new window after expiry');
  });

  it('writes are capped at 10/min per IP independently of reads', async () => {
    const testEnv = env();
    for (let i = 0; i < 10; i++) {
      const resp = await worker.fetch(post({ action: 'submitVote', token: 'nope' }, '10.0.0.2'), testEnv);
      assert.equal(resp.status, 401, `write ${i + 1} passes rate gate (auth fails after)`);
    }
    const blocked = await worker.fetch(post({ action: 'submitVote', token: 'nope' }, '10.0.0.2'), testEnv);
    assert.equal(blocked.status, 429, '11th write in window blocked');

    const readStillFine = await worker.fetch(post({ action: 'getAppData' }, '10.0.0.2'), testEnv);
    assert.equal(readStillFine.status, 200, 'read bucket untouched by write exhaustion');
  });

  it('a venue-NAT burst of readers does not exhaust the shared write budget', async () => {
    const testEnv = env();
    for (let i = 0; i < 60; i++) {
      await worker.fetch(post({ action: 'getAppData' }, '10.0.0.3'), testEnv);
    }
    const vote = await worker.fetch(
      post({ action: 'submitVote', token: 'nope' }, '10.0.0.3'),
      testEnv
    );
    assert.equal(vote.status, 401, 'writes unaffected by heavy shared-IP reading');
  });

  it('after a long idle gap the sweep keeps accounting fresh', async () => {
    const testEnv = env();
    for (let i = 0; i < 89; i++) {
      await worker.fetch(post({ action: 'getAppData' }, '10.0.0.4'), testEnv);
    }
    fakeNow += 6 * 60_000;
    for (let i = 0; i < 90; i++) {
      const resp = await worker.fetch(post({ action: 'getAppData' }, '10.0.0.4'), testEnv);
      assert.equal(resp.status, 200, `post-sweep read ${i + 1} in new window`);
    }
    const blocked = await worker.fetch(post({ action: 'getAppData' }, '10.0.0.4'), testEnv);
    assert.equal(blocked.status, 429, 'counter restarted at sweep, not carried over');
  });
});
