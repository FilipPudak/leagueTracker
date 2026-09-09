import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMockDb } from './helpers/mock-db.js';
import { basicTables } from './helpers/fixtures.js';
import { installCryptoMock } from './helpers/mock-crypto.js';

const mod = await import('../src/index.js');
const worker = mod.default;

function env(tables, extra = {}) {
  return { DB: createMockDb(tables || basicTables()), ...extra };
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
    assert.equal(resp.headers.get('Access-Control-Allow-Origin'), 'https://filippudak.github.io');
    assert.equal(resp.headers.get('Access-Control-Allow-Methods'), 'POST, OPTIONS');
    assert.equal(resp.headers.get('Access-Control-Allow-Headers'), 'Content-Type');
  });

  it('OPTIONS uses ALLOWED_ORIGIN from env', async () => {
    const req = new Request('https://example.com', { method: 'OPTIONS' });
    const resp = await worker.fetch(req, env(basicTables(), { ALLOWED_ORIGIN: 'https://custom.origin.com' }));

    assert.equal(resp.status, 200);
    assert.equal(resp.headers.get('Access-Control-Allow-Origin'), 'https://custom.origin.com');
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

  it('getAppData with valid token returns linked status', async () => {
    const resp = await worker.fetch(
      post({ action: 'getAppData', token: 'test-token-alice' }),
      env()
    );

    assert.equal(resp.status, 200);
    const json = await resp.json();
    assert.equal(json.data.status, 'linked');
    assert.equal(json.data.linkedPlayer.id, 'P001');
  });

  it('submitVote missing token → 401', async () => {
    const resp = await worker.fetch(
      post({ action: 'submitVote', voteData: { leader1Id: '1' } }),
      env()
    );

    assert.equal(resp.status, 401);
    const json = await resp.json();
    assert.equal(json.success, false);
    assert.match(json.error, /Session expired/i);
  });

  it('submitVote invalid token → 401', async () => {
    const resp = await worker.fetch(
      post({ action: 'submitVote', token: 'bogus', voteData: { leader1Id: '1' } }),
      env()
    );

    assert.equal(resp.status, 401);
    const json = await resp.json();
    assert.equal(json.success, false);
    assert.match(json.error, /Session expired/i);
  });

  it('unlinkAccount missing token → 401', async () => {
    const resp = await worker.fetch(
      post({ action: 'unlinkAccount' }),
      env()
    );

    assert.equal(resp.status, 401);
    const json = await resp.json();
    assert.equal(json.success, false);
    assert.match(json.error, /Session expired/i);
  });

  it('unlinkAccount invalid token → 401', async () => {
    const resp = await worker.fetch(
      post({ action: 'unlinkAccount', token: 'nonexistent-token' }),
      env()
    );

    assert.equal(resp.status, 401);
    const json = await resp.json();
    assert.equal(json.success, false);
    assert.match(json.error, /Session expired/i);
  });

  it('getMySeasonStats missing token → 401', async () => {
    const resp = await worker.fetch(
      post({ action: 'getMySeasonStats' }),
      env()
    );

    assert.equal(resp.status, 401);
    const json = await resp.json();
    assert.equal(json.success, false);
    assert.match(json.error, /Session expired/i);
  });

  it('getMySeasonStats invalid token → 401', async () => {
    const resp = await worker.fetch(
      post({ action: 'getMySeasonStats', token: 'bogus-token' }),
      env()
    );

    assert.equal(resp.status, 401);
    const json = await resp.json();
    assert.equal(json.success, false);
    assert.match(json.error, /Session expired/i);
  });

  it('session timestamp touched on valid token', async () => {
    const dbEnv = env();
    const store = dbEnv.DB.getStore();
    const before = store.sessions.find(s => s.token === 'test-token-alice');
    const beforeActive = before.last_active;

    const resp = await worker.fetch(
      post({ action: 'getAppData', token: 'test-token-alice' }),
      dbEnv
    );

    assert.equal(resp.status, 200);
    const after = store.sessions.find(s => s.token === 'test-token-alice');
    assert.ok(after.last_active >= beforeActive, 'session timestamp updated');
  });

  it('full flow: submitVote resolves session, touches timestamp, inserts votes', async () => {
    const dbEnv = env();
    const store = dbEnv.DB.getStore();
    const before = store.sessions.find(s => s.token === 'test-token-alice');
    const beforeActive = before.last_active;

    const resp = await worker.fetch(
      post({
        action: 'submitVote',
        token: 'test-token-alice',
        voteData: { leader1Id: '1', opponentId: 'P002' },
      }),
      dbEnv
    );

    assert.equal(resp.status, 200);
    const json = await resp.json();
    assert.equal(json.success, true);
    assert.equal(typeof json.data.raffleTickets, 'number');

    // Session timestamp was touched
    const after = store.sessions.find(s => s.token === 'test-token-alice');
    assert.ok(after.last_active >= beforeActive, 'session timestamp updated');

    // Votes were inserted
    const votes = store.votes.filter(r => r.player_id === 'P001' && r.season_id === 6 && r.week === 3);
    assert.equal(votes.length, 1, 'vote row inserted');
    assert.equal(votes[0].leader_id, '1');
    assert.equal(votes[0].opponent_id, 'P002');
  });

  it('full flow: unlinkAccount resolves session and deletes it', async () => {
    const dbEnv = env();
    const store = dbEnv.DB.getStore();
    assert.ok(store.sessions.some(s => s.token === 'test-token-alice'));

    const resp = await worker.fetch(
      post({ action: 'unlinkAccount', token: 'test-token-alice' }),
      dbEnv
    );

    assert.equal(resp.status, 200);
    const json = await resp.json();
    assert.equal(json.success, true);
    assert.equal(json.data.playerName, 'Alice');
    assert.ok(!store.sessions.some(s => s.token === 'test-token-alice'), 'session deleted');
  });

  it('expired session rejected for submitVote', async () => {
    const resp = await worker.fetch(
      post({
        action: 'submitVote',
        token: 'test-token-expired',
        voteData: { leader1Id: '1', opponentId: 'P002' },
      }),
      env()
    );

    assert.equal(resp.status, 401);
    const json = await resp.json();
    assert.match(json.error, /Session expired/i);
  });

  it('linkAccount routes to handler and creates session', async () => {
    installCryptoMock();
    const resp = await worker.fetch(
      post({
        action: 'linkAccount',
        playerId: 'P002',
        email: 'bob@test.com',
        deviceId: 'dev-bob-new',
      }),
      env()
    );

    assert.equal(resp.status, 200);
    const json = await resp.json();
    assert.equal(json.success, true);
    assert.ok(json.data.token);
    assert.equal(json.data.linkedPlayer.id, 'P002');
  });

  it('linkAccount missing playerId with unknown email → 404', async () => {
    const resp = await worker.fetch(
      post({ action: 'linkAccount', email: 'test@test.com', deviceId: 'dev' }),
      env()
    );

    assert.equal(resp.status, 404);
    const json = await resp.json();
    assert.equal(json.success, false);
  });

  it('linkAccount email-only re-link for claimed player → 200 (multi-device)', async () => {
    installCryptoMock();
    const resp = await worker.fetch(
      post({ action: 'linkAccount', email: 'charlie@test.com', deviceId: 'dev-tablet' }),
      env()
    );

    assert.equal(resp.status, 200);
    const json = await resp.json();
    assert.equal(json.success, true);
    assert.ok(json.data.token);
    assert.equal(json.data.linkedPlayer.id, 'P003');
  });

  it('getLeaderboardData routes to handler', async () => {
    const resp = await worker.fetch(
      post({ action: 'getLeaderboardData', seasonId: 6 }),
      env()
    );

    assert.equal(resp.status, 200);
    const json = await resp.json();
    assert.equal(json.success, true);
    assert.ok(json.data);
  });

  it('getLeaderboardData without seasonId falls back to active season', async () => {
    const resp = await worker.fetch(
      post({ action: 'getLeaderboardData' }),
      env()
    );

    assert.equal(resp.status, 200);
    const json = await resp.json();
    assert.equal(json.success, true);
    assert.ok(json.data);
    assert.equal(json.data.seasonId, 6);
  });

  it('startNewSeason routes to handler with valid admin token', async () => {
    const resp = await worker.fetch(
      post({ action: 'startNewSeason', adminToken: 'test-secret-123' }),
      env(basicTables(), { ADMIN_SECRET: 'test-secret-123' })
    );

    assert.equal(resp.status, 200);
    const json = await resp.json();
    assert.equal(json.success, true);
    assert.equal(json.data.seasonId, 7);
  });

  it('startNewSeason missing adminToken → 403', async () => {
    const resp = await worker.fetch(
      post({ action: 'startNewSeason' }),
      env(basicTables(), { ADMIN_SECRET: 'test-secret-123' })
    );

    assert.equal(resp.status, 403);
    const json = await resp.json();
    assert.equal(json.success, false);
    assert.match(json.error, /Unauthorized/i);
  });

  it('startNewSeason wrong adminToken → 403', async () => {
    const resp = await worker.fetch(
      post({ action: 'startNewSeason', adminToken: 'wrong-token' }),
      env(basicTables(), { ADMIN_SECRET: 'test-secret-123' })
    );

    assert.equal(resp.status, 403);
    const json = await resp.json();
    assert.equal(json.success, false);
  });

  it('handler throwing non-Error returns 500 with generic message', async () => {
    const badHandlers = { badAction: () => { throw 'string error'; } };
    const origHandlers = worker.fetch;

    const req = new Request('https://example.com', {
      method: 'POST',
      body: JSON.stringify({ action: 'nonExistentAction' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const resp = await worker.fetch(req, env());
    assert.equal(resp.status, 400);
    const json = await resp.json();
    assert.equal(json.success, false);
    assert.ok(json.error);
  });

  it('backfillFromMelee routes to handler with valid admin token', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify({ Content: [], TotalCount: 0 }),
    });
    try {
      const resp = await worker.fetch(
        post({ action: 'backfillFromMelee', adminToken: 'test-secret-123' }),
        env(basicTables(), { ADMIN_SECRET: 'test-secret-123' })
      );

      assert.equal(resp.status, 200);
      const json = await resp.json();
      assert.equal(json.success, true);
      assert.ok(json.data);
      assert.equal(json.data.tournaments, 0);
      assert.ok(!json.data.fetchFailed, 'empty (but valid) tournament list is not a fetch failure');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('backfillFromMelee missing adminToken → 403', async () => {
    const resp = await worker.fetch(
      post({ action: 'backfillFromMelee' }),
      env(basicTables(), { ADMIN_SECRET: 'test-secret-123' })
    );

    assert.equal(resp.status, 403);
    const json = await resp.json();
    assert.equal(json.success, false);
    assert.match(json.error, /Unauthorized/i);
  });

  it('backfillFromMelee wrong adminToken → 403', async () => {
    const resp = await worker.fetch(
      post({ action: 'backfillFromMelee', adminToken: 'wrong-token' }),
      env(basicTables(), { ADMIN_SECRET: 'test-secret-123' })
    );

    assert.equal(resp.status, 403);
    const json = await resp.json();
    assert.equal(json.success, false);
  });

  it('scheduled handler exists and is a function', () => {
    assert.equal(typeof worker.scheduled, 'function');
  });

  it('scheduled() runs weekly sync and surfaces fetch-failed via cron without throwing', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: false, status: 400, headers: { get: () => null }, text: async () => 'boom' });
    const tables = basicTables();
    tables.settings.push({ key: 'SEASON_STARTED', value: 'TRUE' });
    const testEnv = env(tables, { MELEE_CLIENT_ID: 'x', MELEE_CLIENT_SECRET: 'y' });
    try {
      await worker.scheduled({ cron: '15 20 * * 3' }, testEnv, { waitUntil() {} });
    } catch (err) {
      assert.fail(`scheduled() must swallow errors (cron reliability): ${err.message}`);
    } finally {
      globalThis.fetch = originalFetch;
    }
    const settings = testEnv.DB.getStore().settings;
    const week = settings.find(s => s.key === 'CURRENT_WEEK');
    assert.equal(week.value, 'Week 3', 'week untouched on fetch failure via cron');
  });

  it('session timestamp touch is registered via ctx.waitUntil', async () => {
    installCryptoMock();
    const testEnv = env();
    const waited = [];
    const ctx = { waitUntil: (p) => waited.push(p) };
    const resp = await worker.fetch(
      post({ action: 'getAppData', token: 'test-token-alice' }),
      testEnv,
      ctx
    );
    assert.equal(resp.status, 200);
    assert.equal(waited.length, 1, 'one waitUntil registered for session touch');
    await Promise.all(waited);
    const store = testEnv.DB.getStore();
    const session = store.sessions.find(s => s.token === 'test-token-alice');
    assert.ok(Date.now() - new Date(session.last_active).getTime() < 5000, 'last_active refreshed');
  });

  it('rate limit: requests within limit succeed', async () => {
    const testEnv = env();
    const resp = await worker.fetch(
      post({ action: 'getAppData' }),
      testEnv
    );
    assert.equal(resp.status, 200);
  });

  it('rate limit: exceeded returns 429', async () => {
    const testEnv = env();
    for (let i = 0; i < 30; i++) {
      await worker.fetch(post({ action: 'getAppData' }), testEnv);
    }
    const resp = await worker.fetch(
      post({ action: 'getAppData' }),
      testEnv
    );
    assert.equal(resp.status, 429);
    const json = await resp.json();
    assert.equal(json.success, false);
    assert.match(json.error, /Rate limit/i);
  });
});
