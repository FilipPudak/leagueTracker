import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMockDb } from './helpers/mock-db.js';
import { basicTables } from './helpers/fixtures.js';

const mod = await import('../src/index.js');
const worker = mod.default;

function env(tables) {
  return { DB: createMockDb(tables || basicTables()) };
}

function post(body, opts = {}) {
  return new Request('https://example.com', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
}

describe('router/index.js – fetch handler', () => {
  it('OPTIONS request returns CORS headers with 200', async () => {
    const req = new Request('https://example.com', { method: 'OPTIONS' });
    const resp = await worker.fetch(req, env());

    assert.equal(resp.status, 200);
    assert.equal(resp.headers.get('Access-Control-Allow-Origin'), '*');
    assert.equal(resp.headers.get('Access-Control-Allow-Methods'), 'POST, OPTIONS');
    assert.equal(resp.headers.get('Access-Control-Allow-Headers'), 'Content-Type');
  });

  it('non-POST request returns 405', async () => {
    const req = new Request('https://example.com', { method: 'GET' });
    const resp = await worker.fetch(req, env());

    assert.equal(resp.status, 405);
    const json = await resp.json();
    assert.equal(json.success, false);
    assert.equal(json.error, 'Method not allowed');
  });

  it('invalid JSON body returns 400', async () => {
    const req = new Request('https://example.com', {
      method: 'POST',
      body: 'not valid json{{{',
      headers: { 'Content-Type': 'application/json' },
    });
    const resp = await worker.fetch(req, env());

    assert.equal(resp.status, 400);
    const json = await resp.json();
    assert.equal(json.success, false);
    assert.equal(json.error, 'Invalid JSON');
  });

  it('unknown action returns 400 with sanitized message', async () => {
    const resp = await worker.fetch(
      post({ action: 'nonExistentAction', token: '' }),
      env()
    );

    assert.equal(resp.status, 400);
    const json = await resp.json();
    assert.equal(json.success, false);
    assert.match(json.error, /Unknown action/i);
  });

  it('valid getAppData action returns success with data', async () => {
    const resp = await worker.fetch(
      post({ action: 'getAppData', token: '' }),
      env()
    );

    assert.equal(resp.status, 200);
    const json = await resp.json();
    assert.equal(json.success, true);
    assert.ok(json.data);
    assert.equal(json.data.status, 'unlinked');
    assert.equal(json.data.votingOpen, true);
    assert.equal(json.data.activeSeasonId, 6);
    assert.equal(json.data.week, 3);
    assert.ok(Array.isArray(json.data.players));
    assert.ok(Array.isArray(json.data.leaders));
  });

  it('handler error returns {success:false} with correct status', async () => {
    const resp = await worker.fetch(
      post({ action: 'submitVote' }),
      env()
    );

    assert.equal(resp.status, 401);
    const json = await resp.json();
    assert.equal(json.success, false);
    assert.match(json.error, /Session expired/i);
  });
});
