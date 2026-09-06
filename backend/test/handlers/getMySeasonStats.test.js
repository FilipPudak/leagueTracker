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

  it('returns awards won, leaders, compliance, streaks, raffleTickets', async () => {
    const result = await handleGetMySeasonStats(
      { seasonId: 6 },
      env,
      aliceSession
    );
    assert.ok(Array.isArray(result.awardsWon));
    assert.ok(Array.isArray(result.leaders));
    assert.ok(result.compliance);
    assert.ok(result.streaks);
    assert.equal(typeof result.raffleTickets, 'number');
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

  it('awards won lists only awards for this player', async () => {
    const result = await handleGetMySeasonStats(
      { seasonId: 6 },
      env,
      aliceSession
    );
    assert.ok(result.awardsWon.includes('Galactic Schemer'));
    assert.ok(result.awardsWon.includes('Galactic Ambassador'));
    assert.ok(result.awardsWon.includes('Galactic Ruler'));
  });

  it('compliance has correct structure', async () => {
    const result = await handleGetMySeasonStats(
      { seasonId: 6 },
      env,
      aliceSession
    );
    assert.equal(typeof result.compliance.weeksVoted, 'number');
    assert.equal(typeof result.compliance.weeksAttended, 'number');
    assert.equal(typeof result.compliance.compliancePct, 'number');
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
    assert.ok(result.compliance);
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
});
