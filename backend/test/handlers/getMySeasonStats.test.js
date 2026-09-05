import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMockDb } from '../helpers/mock-db.js';
import { basicTables } from '../helpers/fixtures.js';
import { installCryptoMock } from '../helpers/mock-crypto.js';
import { handleGetMySeasonStats } from '../../src/handlers/getMySeasonStats.js';

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
      { token: 'test-token-alice', seasonId: 6 },
      env
    );
    assert.ok(Array.isArray(result.awardsWon));
    assert.ok(Array.isArray(result.leaders));
    assert.ok(result.compliance);
    assert.ok(result.streaks);
    assert.equal(typeof result.raffleTickets, 'number');
  });

  it('missing token → 401', async () => {
    await assert.rejects(
      () => handleGetMySeasonStats({ seasonId: 6 }, env),
      (err) => {
        assert.equal(err.status, 401);
        return true;
      }
    );
  });

  it('invalid session → 401', async () => {
    await assert.rejects(
      () => handleGetMySeasonStats({ token: 'bogus-token', seasonId: 6 }, env),
      (err) => {
        assert.equal(err.status, 401);
        return true;
      }
    );
  });

  it('no seasonId → 400', async () => {
    await assert.rejects(
      () => handleGetMySeasonStats({ token: 'test-token-alice' }, env),
      (err) => {
        assert.equal(err.status, 400);
        return true;
      }
    );
  });

  it('returns correct leader play counts', async () => {
    const result = await handleGetMySeasonStats(
      { token: 'test-token-alice', seasonId: 6 },
      env
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
      { token: 'test-token-alice', seasonId: 6 },
      env
    );
    assert.ok(result.awardsWon.includes('Galactic Schemer'));
    assert.ok(result.awardsWon.includes('Galactic Ambassador'));
    assert.ok(result.awardsWon.includes('Galactic Ruler'));
  });
});
