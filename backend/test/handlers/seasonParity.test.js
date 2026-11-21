import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMockDb } from '../helpers/mock-db.js';
import { basicTables } from '../helpers/fixtures.js';
import { installCryptoMock } from '../helpers/mock-crypto.js';
import { handleGetMySeasonStats } from '../../src/handlers/getMySeasonStats.js';
import { handleGetPlayerProfile } from '../../src/handlers/getPlayerProfile.js';

const aliceSession = { token: 'test-token-alice', player_id: 'P001', device_id: 'dev-alice', email: 'alice@test.com' };

function parityTables() {
  const t = basicTables();
  t.settings = t.settings.map(s => s.key === 'ACTIVE_SEASON_ID' ? { ...s, value: '5' } : s);
  t.melee_tournaments = [
    { season_id: 6, round: 1, melee_id: 'm1', name: 'Week 1', phase: 'regular' },
    { season_id: 6, round: 2, melee_id: 'm2', name: 'Week 2', phase: 'regular' },
    { season_id: 6, round: 3, melee_id: 'm3', name: 'Cut', phase: 'cut' },
  ];
  t.season_standings = [
    { season_id: 6, round: 1, player_id: 'P001', wins: 3, losses: 0, draws: 0, rank: 1 },
    { season_id: 6, round: 1, player_id: 'P002', wins: 1, losses: 2, draws: 0, rank: 2 },
    { season_id: 6, round: 2, player_id: 'P001', wins: 2, losses: 1, draws: 0, rank: 2 },
    { season_id: 6, round: 2, player_id: 'P002', wins: 3, losses: 0, draws: 0, rank: 1 },
    { season_id: 6, round: 3, player_id: 'P001', wins: 0, losses: 3, draws: 0, rank: 2 },
    { season_id: 6, round: 3, player_id: 'P002', wins: 3, losses: 0, draws: 0, rank: 1 },
  ];
  t.attendance = [
    { season_id: 6, week: 1, player_id: 'P001' },
    { season_id: 6, week: 2, player_id: 'P001' },
  ];
  t.votes = [
    { id: 1, timestamp: new Date().toISOString(), updated_at: null, season_id: 6, week: 1, player_id: 'P001', leader_id: '1', opponent_id: 'P002' },
    { id: 2, timestamp: new Date().toISOString(), updated_at: null, season_id: 6, week: 2, player_id: 'P001', leader_id: '3', opponent_id: 'P002' },
  ];
  return t;
}

describe('My Stats / public profile season parity', () => {
  it('both handlers build one identical season section from the same fixtures', async () => {
    installCryptoMock();
    const DB = createMockDb(parityTables());
    const env = { DB };

    const mine = await handleGetMySeasonStats({ seasonId: 6 }, env, aliceSession);
    const profile = await handleGetPlayerProfile({ playerId: 'P001', seasonId: 6 }, env);

    assert.deepEqual(mine.season, profile.season,
      'rank/points/nights/W-D-L/leaders/awards must be identical on both surfaces');
  });

  it('the shared section excludes cut nights and keeps awardsWon as strings', async () => {
    installCryptoMock();
    const DB = createMockDb(parityTables());
    const env = { DB };

    const mine = await handleGetMySeasonStats({ seasonId: 6 }, env, aliceSession);

    assert.deepEqual(mine.season.nights.map(n => n.round), [1, 2]);
    assert.deepEqual([...mine.awardsWon].sort(), ['Galactic Ambassador', 'Galactic Ruler', 'Galactic Schemer']);
    assert.ok(mine.awardsWon.every(a => typeof a === 'string'),
      'old cached frontends must never render [object Object]');
  });
});
