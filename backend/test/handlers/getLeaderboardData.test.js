import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMockDb } from '../helpers/mock-db.js';
import { basicTables, emptyTables } from '../helpers/fixtures.js';
import { installCryptoMock } from '../helpers/mock-crypto.js';
import { createFetchMock } from '../helpers/mock-fetch.js';
import { handleGetLeaderboardData } from '../../src/handlers/getLeaderboardData.js';

function leaderboardTables() {
  const t = basicTables();
  t.settings = t.settings.map(s =>
    s.key === 'ACTIVE_SEASON_ID' ? { ...s, value: '6' } : s
  );
  return t;
}

describe('handleGetLeaderboardData', () => {
  let DB;
  let env;
  let fetchMock;

  beforeEach(() => {
    installCryptoMock();
    fetchMock = createFetchMock();
    globalThis.fetch = fetchMock.handler;
    const tables = leaderboardTables();
    DB = createMockDb(tables);
    env = { DB };
  });

  it('returns stored awards with resolved player names', async () => {
    const result = await handleGetLeaderboardData({ seasonId: 6 }, env);
    assert.ok(result.schemer);
    assert.ok(result.schemer.length > 0);
    const first = result.schemer[0];
    assert.ok(first.name);
    assert.ok(typeof first.score === 'string');
  });

  it('scores formatted as "X Pts", "X Leaders", "X Votes", "+X Climb"', async () => {
    const result = await handleGetLeaderboardData({ seasonId: 6 }, env);
    if (result.schemer && result.schemer.length > 0) {
      assert.ok(/\d+ Leaders/.test(result.schemer[0].score), `schemer score: ${result.schemer[0].score}`);
    }
    if (result.ambassador && result.ambassador.length > 0) {
      assert.ok(/\d+ Votes/.test(result.ambassador[0].score), `ambassador score: ${result.ambassador[0].score}`);
    }
    if (result.ruler && result.ruler.length > 0) {
      assert.ok(/\d+ Pts/.test(result.ruler[0].score), `ruler score: ${result.ruler[0].score}`);
    }
    if (result.newHope && result.newHope.length > 0) {
      assert.ok(/\+\d+ Climb/.test(result.newHope[0].score), `newHope score: ${result.newHope[0].score}`);
    }
  });

  it('empty leaderLeaderboard when no vote data', async () => {
    const db = createMockDb(emptyTables());
    const result = await handleGetLeaderboardData({ seasonId: 1 }, { DB: db });
    assert.ok(Array.isArray(result.leaderLeaderboard));
    assert.equal(result.leaderLeaderboard.length, 0);
  });

  it('returns participation data', async () => {
    const result = await handleGetLeaderboardData({ seasonId: 6 }, env);
    assert.ok(result.participation);
    assert.equal(typeof result.participation.participationPct, 'number');
    assert.equal(typeof result.participation.totalPlayers, 'number');
    assert.equal(typeof result.participation.playersWhoVoted, 'number');
  });

  it('no season specified falls back to active season', async () => {
    const result = await handleGetLeaderboardData({}, env);
    assert.ok(result.schemer);
    assert.ok(result.participation);
  });

  it('invalid season → 400', async () => {
    const tables = leaderboardTables();
    tables.settings = tables.settings.filter((s) => s.key !== 'ACTIVE_SEASON_ID');
    const db = createMockDb(tables);
    await assert.rejects(
      () => handleGetLeaderboardData({}, { DB: db }),
      (err) => {
        assert.equal(err.status, 400);
        return true;
      }
    );
  });
});
