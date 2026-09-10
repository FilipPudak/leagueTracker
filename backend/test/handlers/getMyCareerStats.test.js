import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMockDb } from '../helpers/mock-db.js';
import { basicTables } from '../helpers/fixtures.js';
import { handleGetMyCareerStats } from '../../src/handlers/getMyCareerStats.js';

const aliceSession = { token: 'test-token-alice', player_id: 'P001', device_id: 'dev-alice', email: 'alice@test.com' };

function seededTables() {
  const tables = basicTables();
  tables.melee_tournaments = [
    { melee_id: 100, season_id: 5, round: 1, name: 'SWU Wednesday league season 5 01/01', date: '2026-01-01', phase: 'regular' },
    { melee_id: 101, season_id: 6, round: 1, name: 'SWU Wednesday league season 6 01/07', date: '2026-07-01', phase: 'regular' },
    { melee_id: 102, season_id: 6, round: 2, name: 'SWU Wednesday league season 6 08/07', date: '2026-07-08', phase: 'regular' },
    { melee_id: 103, season_id: 6, round: 3, name: 'SWU Wednesday league season 6 TOP 4', date: '2026-07-15', phase: 'cut' },
  ];
  tables.season_standings = [
    { season_id: 5, round: 1, player_id: 'P001', wins: 1, losses: 2, draws: 0, match_points: 3, rank: 2 },
    { season_id: 5, round: 1, player_id: 'P002', wins: 3, losses: 0, draws: 0, match_points: 9, rank: 1 },
    { season_id: 6, round: 1, player_id: 'P001', wins: 3, losses: 0, draws: 0, match_points: 9, rank: 1 },
    { season_id: 6, round: 1, player_id: 'P002', wins: 1, losses: 2, draws: 0, match_points: 3, rank: 2 },
    { season_id: 6, round: 2, player_id: 'P001', wins: 1, losses: 2, draws: 0, match_points: 3, rank: 2 },
    { season_id: 6, round: 2, player_id: 'P002', wins: 2, losses: 0, draws: 1, match_points: 7, rank: 1 },
    { season_id: 6, round: 3, player_id: 'P001', wins: 4, losses: 0, draws: 0, match_points: 12, rank: 1 },
  ];
  tables.match_results = [
    { season_id: 5, round: 1, melee_match_id: 'm1', player1_id: 'P002', player2_id: 'P001', winner_id: 'P002', result: 'Bob won 2-1-0', is_bye: 0 },
    { season_id: 6, round: 1, melee_match_id: 'm2', player1_id: 'P001', player2_id: 'P002', winner_id: 'P001', result: 'Alice won 2-0-0', is_bye: 0 },
    { season_id: 6, round: 2, melee_match_id: 'm3', player1_id: 'P001', player2_id: 'P003', winner_id: 'P003', result: 'Charlie won 2-1-0', is_bye: 0 },
    { season_id: 6, round: 3, melee_match_id: 'm4', player1_id: 'P001', player2_id: null, winner_id: 'P001', result: null, is_bye: 1 },
  ];
  return tables;
}

describe('handleGetMyCareerStats', () => {
  let env;

  beforeEach(() => {
    env = { DB: createMockDb(seededTables()) };
  });

  it('rejects without session (401)', async () => {
    await assert.rejects(
      () => handleGetMyCareerStats({}, env, null),
      (err) => { assert.equal(err.status, 401); return true; }
    );
  });

  it('returns rivalry, record, progression and peak from all seasons', async () => {
    const result = await handleGetMyCareerStats({}, env, aliceSession);

    assert.equal(result.hasCareerData, true);
    assert.equal(result.record.nights, 3, 'regular nights only — cut round 3 excluded');
    assert.equal(result.record.sinceSeason, 5);
    assert.equal(result.record.matches.byes, undefined);

    assert.equal(result.rivalry.headToHead.length, 2);
    assert.equal(result.rivalry.headToHead[0].name, 'Bob', 'most-played opponent first');

    assert.equal(result.progression.length, 2, 'fixture seasons: 5 and 6');
    const s6 = result.progression.find(p => p.seasonId === 6);
    assert.equal(s6.rank, 1, 'S6 derived: Alice 12 pts > Bob 10 pts');
    assert.equal(s6.isCurrent, true);

    assert.deepEqual(result.peak, { rank: 1, seasonId: 6 });
  });

  it('excludes cut rounds from derived season rank', async () => {
    const result = await handleGetMyCareerStats({}, env, aliceSession);
    const s6 = result.progression.find(p => p.seasonId === 6);
    assert.equal(s6.points, 12, 'only regular nights (r1 9 + r2 3), cut round r3 ignored');
    assert.equal(s6.nightsPlayed, 2, 'cut standing not counted as played night');
  });

  it('marks active season with asOfRound of latest synced regular round', async () => {
    const result = await handleGetMyCareerStats({}, env, aliceSession);
    const s6 = result.progression.find(p => p.seasonId === 6);
    assert.equal(s6.asOfRound, 2);
  });

  it('empty career for a player with no history', async () => {
    const tables = basicTables();
    const result = await handleGetMyCareerStats({}, { DB: createMockDb(tables) }, aliceSession);
    assert.equal(result.hasCareerData, false);
    assert.equal(result.record.nights, 0);
    assert.equal(result.record.sinceSeason, null);
    assert.deepEqual(result.rivalry.nemesis, []);
    assert.deepEqual(result.rivalry.victim, []);
    assert.equal(result.peak, null);
    assert.ok(result.progression.every(p => p.rank === null));
  });

  it('seasons the player never played appear as null-rank gaps', async () => {
    const tables = seededTables();
    tables.seasons.push({ id: 4, name: 'Season 4', created_date: null, length: 15, top_results: 10 });
    env = { DB: createMockDb(tables) };
    const result = await handleGetMyCareerStats({}, env, aliceSession);
    const s4 = result.progression.find(p => p.seasonId === 4);
    assert.equal(s4.rank, null);
    assert.equal(s4.nightsPlayed, 0);
    assert.equal(s4.isCurrent, false);
  });
});
