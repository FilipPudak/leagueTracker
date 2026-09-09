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

function post(body) {
  return new Request('https://example.com', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function requestIp(ip) {
  return new Request('https://example.com', {
    method: 'POST',
    body: JSON.stringify({ action: 'getAppData' }),
    headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': ip },
  });
}

describe('rate limiter window behavior', () => {
  afterEach(() => {
    fakeNow = realNow;
  });

  it('blocks at 31 within the window and recovers after the window expires', async () => {
    const testEnv = env();
    for (let i = 0; i < 30; i++) {
      const resp = await worker.fetch(post({ action: 'getAppData' }), testEnv);
      assert.equal(resp.status, 200, `request ${i + 1} within limit`);
    }
    const blocked = await worker.fetch(post({ action: 'getAppData' }), testEnv);
    assert.equal(blocked.status, 429);

    fakeNow += 61_000;
    const recovered = await worker.fetch(post({ action: 'getAppData' }), testEnv);
    assert.equal(recovered.status, 200, 'new window after expiry');
  });

  it('limits are tracked per IP independently', async () => {
    const testEnv = env();
    for (let i = 0; i < 30; i++) {
      await worker.fetch(requestIp('1.2.3.4'), testEnv);
    }
    const blocked = await worker.fetch(requestIp('1.2.3.4'), testEnv);
    assert.equal(blocked.status, 429);
    const other = await worker.fetch(requestIp('5.6.7.8'), testEnv);
    assert.equal(other.status, 200, 'different IP unaffected');
  });

  it('after a long idle gap the sweep keeps accounting fresh (full window available again)', async () => {
    const testEnv = env();
    for (let i = 0; i < 29; i++) {
      await worker.fetch(requestIp('9.9.9.9'), testEnv);
    }
    fakeNow += 6 * 60_000;
    for (let i = 0; i < 30; i++) {
      const resp = await worker.fetch(requestIp('9.9.9.9'), testEnv);
      assert.equal(resp.status, 200, `post-sweep request ${i + 1} in new window`);
    }
    const blocked = await worker.fetch(requestIp('9.9.9.9'), testEnv);
    assert.equal(blocked.status, 429, 'counter restarted from zero at sweep, not carried over');
  });
});
