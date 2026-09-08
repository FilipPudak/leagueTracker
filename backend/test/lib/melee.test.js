import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { MeleeClient } from '../../src/lib/melee.js';

describe('MeleeClient', () => {
  let originalFetch;
  let fetchCalls;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchCalls = [];
    globalThis.fetch = async (url, opts) => {
      fetchCalls.push({ url, opts });
      if (url.includes('rate-limited')) {
        return { ok: false, status: 429, headers: new Map([['retry-after', '1']]), text: async () => 'Rate limited' };
      }
      if (url.includes('server-error')) {
        return { ok: false, status: 500, text: async () => 'Server error' };
      }
      if (url.includes('tournament/list')) {
        return {
          ok: true, status: 200,
          text: async () => JSON.stringify({ Content: [{ ID: 100, Name: 'Test Tournament', StartDate: '2026-01-01' }], TotalCount: 1 }),
        };
      }
      if (url.includes('/api/standing/list/current/')) {
        return {
          ok: true, status: 200,
          text: async () => JSON.stringify({ Content: [{ Username: 'alice42', GameWins: 3, GameLosses: 1, MatchPoints: 9 }] }),
        };
      }
      if (url.includes('/api/match/list/')) {
        return {
          ok: true, status: 200,
          text: async () => JSON.stringify({ Content: [{ ID: 500, Competitors: [{ Team: { Players: [{ Username: 'alice42' }] } }, { Team: { Players: [{ Username: 'bob55' }] } }], WinnerId: null }] }),
        };
      }
      if (url.includes('/api/player/')) {
        return {
          ok: true, status: 200,
          text: async () => JSON.stringify({ Content: { ID: 'guid-123', Username: 'alice42' } }),
        };
      }
      return { ok: false, status: 404, text: async () => 'Not found' };
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('constructor sets clientId and clientSecret', () => {
    const client = new MeleeClient('id', 'secret');
    assert.equal(client.clientId, 'id');
    assert.equal(client.clientSecret, 'secret');
  });

  it('listTournaments sends correct auth header', async () => {
    const client = new MeleeClient('user', 'pass');
    await client.listTournaments(1, 1, 10);
    assert.equal(fetchCalls.length, 1);
    const auth = fetchCalls[0].opts.headers['Authorization'];
    assert.ok(auth.startsWith('Basic '));
    const decoded = atob(auth.slice(6));
    assert.equal(decoded, 'user:pass');
  });

  it('listTournaments constructs correct URL with query params', async () => {
    const client = new MeleeClient('id', 'secret');
    await client.listTournaments(1, 0, 50);
    const url = fetchCalls[0].url;
    assert.ok(url.includes('OrganizationId=1'));
    assert.ok(url.includes('variables.page=1'));
    assert.ok(url.includes('variables.pageSize=50'));
    assert.ok(url.includes('Game=StarWarsUnlimited'));
  });

  it('listTournaments returns Content array and TotalCount', async () => {
    const client = new MeleeClient('id', 'secret');
    const result = await client.listTournaments(1, 0, 10);
    assert.ok(Array.isArray(result.Content));
    assert.equal(result.TotalCount, 1);
    assert.equal(result.Content[0].ID, 100);
  });

  it('getStandings sends correct auth and tournament ID', async () => {
    const client = new MeleeClient('id', 'secret');
    await client.getStandings(100);
    const url = fetchCalls[0].url;
    assert.ok(url.includes('/api/standing/list/current/100'));
  });

  it('getStandings returns Content array', async () => {
    const client = new MeleeClient('id', 'secret');
    const result = await client.getStandings(100);
    assert.ok(Array.isArray(result.Content));
    assert.equal(result.Content[0].Username, 'alice42');
  });

  it('getMatches sends correct auth and tournament ID in path', async () => {
    const client = new MeleeClient('id', 'secret');
    await client.getMatches(100);
    const url = fetchCalls[0].url;
    assert.ok(url.includes('/api/match/list/100'));
  });

  it('getMatches returns Content array', async () => {
    const client = new MeleeClient('id', 'secret');
    const result = await client.getMatches(100);
    assert.ok(Array.isArray(result.Content));
    assert.equal(result.Content[0].ID, 500);
  });

  it('getPlayer returns player info by username', async () => {
    const client = new MeleeClient('id', 'secret');
    const result = await client.getPlayer('alice42');
    assert.equal(result.Content.ID, 'guid-123');
    assert.equal(result.Content.Username, 'alice42');
  });

  it('retries on 429 rate limit', async () => {
    let rateLimitCalls = 0;
    globalThis.fetch = async (url, opts) => {
      fetchCalls.push({ url, opts });
      rateLimitCalls++;
      if (rateLimitCalls <= 2) {
        return { ok: false, status: 429, headers: new Map([['retry-after', '0']]), text: async () => 'Rate limited' };
      }
      return {
        ok: true, status: 200,
        text: async () => JSON.stringify({ Content: [{ ID: 1 }], TotalCount: 1 }),
      };
    };
    const client = new MeleeClient('id', 'secret');
    const result = await client.listTournaments(1, 0, 10);
    assert.equal(rateLimitCalls, 3, 'should make 3 calls (1 initial + 2 retries) on 429');
    assert.ok(result.Content, 'should eventually succeed');
  });

  it('throws after max retries on persistent 500', async () => {
    globalThis.fetch = async () => ({
      ok: false, status: 500, text: async () => 'Server error',
    });
    const client = new MeleeClient('id', 'secret');
    await assert.rejects(
      () => client.listTournaments(1, 0, 10),
      { message: /Melee API request failed after/ }
    );
  });

  it('throws on non-ok response', async () => {
    globalThis.fetch = async () => ({
      ok: false, status: 403, text: async () => 'Forbidden',
    });
    const client = new MeleeClient('id', 'secret');
    await assert.rejects(
      () => client.listTournaments(1, 0, 10),
      { message: /Melee API request failed/ }
    );
  });
});
