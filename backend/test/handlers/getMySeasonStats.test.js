import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMockDb } from '../helpers/mock-db.js';
import { basicTables } from '../helpers/fixtures.js';
import { installCryptoMock } from '../helpers/mock-crypto.js';
import { handleGetMySeasonStats } from '../../src/handlers/getMySeasonStats.js';

const aliceSession = { token: 'test-token-alice', player_id: 'P001', device_id: 'dev-alice', email: 'alice@test.com' };

describe('handleGetMySeasonStats', () => {
  let DB;
  let env;

  beforeEach(() => {
    installCryptoMock();
    const tables = basicTables();
    DB = createMockDb(tables);
    env = { DB };
  });

  it('returns awards won, leaders, streaks, raffleTickets, milestone', async () => {
    const result = await handleGetMySeasonStats(
      { seasonId: 6 },
      env,
      aliceSession
    );
    assert.ok(Array.isArray(result.awardsWon));
    assert.ok(Array.isArray(result.leaders));
    assert.ok(result.streaks);
    assert.equal(typeof result.raffleTickets, 'number');
    assert.equal(result.isCurrentSeason, true);
  });

  it('no seasonId falls back to active season', async () => {
    const result = await handleGetMySeasonStats({}, env, aliceSession);
    assert.ok(result.awardsWon);
    assert.ok(result.leaders);
  });

  it('returns correct leader play counts', async () => {
    const result = await handleGetMySeasonStats(
      { seasonId: 6 },
      env,
      aliceSession
    );
    assert.ok(result.leaders.length >= 1);
    let totalPlays = 0;
    for (const leader of result.leaders) {
      assert.equal(typeof leader.plays, 'number');
      assert.ok(leader.plays > 0);
      totalPlays += leader.plays;
    }
    assert.equal(totalPlays, 2);
  });

  it('closed season lists awards won for this player', async () => {
    const tables = basicTables();
    tables.settings = tables.settings.map(s =>
      s.key === 'ACTIVE_SEASON_ID' ? { ...s, value: '5' } : s
    );
    const db = createMockDb(tables);
    const result = await handleGetMySeasonStats(
      { seasonId: 6 },
      { DB: db },
      aliceSession
    );
    assert.equal(result.isCurrentSeason, false);
    assert.ok(result.awardsWon.includes('Galactic Schemer'));
    assert.ok(result.awardsWon.includes('Galactic Ambassador'));
    assert.ok(result.awardsWon.includes('Galactic Ruler'));
    assert.ok(!result.awardsWon.includes('A New Hope'), 'P001 is not top scorer of A New Hope');
  });

  it('active season lists NO awards mid-season (winners declared at close)', async () => {
    const result = await handleGetMySeasonStats(
      { seasonId: 6 },
      env,
      aliceSession
    );
    assert.equal(result.isCurrentSeason, true);
    assert.deepEqual(result.awardsWon, [], 'stored mid-season podium rows must not surface as won');
  });

  it('current season includes milestone progress toward target', async () => {
    const result = await handleGetMySeasonStats(
      { seasonId: 6 },
      env,
      aliceSession
    );
    assert.deepEqual(result.milestone, { votes: 2, target: 4, complete: false });
    assert.equal(result.hasVoteData, true);
    assert.equal(typeof result.streaks.currentStreak, 'number', 'current streak exposed for active season');
  });

  it('historical season: milestone null, streaks best-only, no-vote era hidden', async () => {
    const result = await handleGetMySeasonStats(
      { seasonId: 5 },
      env,
      aliceSession
    );
    assert.equal(result.isCurrentSeason, false);
    assert.equal(result.milestone, null);
    assert.equal(result.hasVoteData, false);
    assert.deepEqual(Object.keys(result.streaks), ['bestStreak']);
  });

  it('streaks has currentStreak and bestStreak', async () => {
    const result = await handleGetMySeasonStats(
      { seasonId: 6 },
      env,
      aliceSession
    );
    assert.equal(typeof result.streaks.currentStreak, 'number');
    assert.equal(typeof result.streaks.bestStreak, 'number');
    assert.ok(result.streaks.bestStreak >= result.streaks.currentStreak);
  });

  it('raffleTickets match vote count', async () => {
    const result = await handleGetMySeasonStats(
      { seasonId: 6 },
      env,
      aliceSession
    );
    assert.equal(result.raffleTickets, 2, 'Alice voted in weeks 1 and 2');
  });

  it('falls back to active season when no seasonId provided', async () => {
    const result = await handleGetMySeasonStats(
      {},
      env,
      aliceSession
    );
    assert.ok(result.awardsWon);
    assert.ok(result.leaders);
    assert.equal(result.isCurrentSeason, true, 'fallback resolves to active season');
  });

  it('null session (bypassing router) → 401', async () => {
    await assert.rejects(
      () => handleGetMySeasonStats({ seasonId: 6 }, env, null),
      (err) => {
        assert.equal(err.status, 401);
        return true;
      }
    );
  });

  it('garbage seasonId → 400 instead of silent fallback to active season', async () => {
    await assert.rejects(
      () => handleGetMySeasonStats({ seasonId: 'banana' }, env, aliceSession),
      (err) => {
        assert.equal(err.status, 400);
        assert.match(err.message, /Invalid seasonId/);
        return true;
      }
    );
  });

  it('no active season → 400', async () => {
    const tables = basicTables();
    tables.settings = tables.settings.filter(s => s.key !== 'ACTIVE_SEASON_ID');
    const db = createMockDb(tables);
    await assert.rejects(
      () => handleGetMySeasonStats({}, { DB: db }, aliceSession),
      (err) => {
        assert.equal(err.status, 400);
        assert.match(err.message, /No active season/i);
        return true;
      }
    );
  });
});
