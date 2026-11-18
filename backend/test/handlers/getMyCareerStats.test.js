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

    assert.deepEqual(result.peak, [{ rank: 1, seasonId: 6 }]);
  });

  it('excludes cut rounds from derived season rank', async () => {
    const result = await handleGetMyCareerStats({}, env, aliceSession);
    const s6 = result.progression.find(p => p.seasonId === 6);
    assert.equal(s6.points, 12, 'only regular nights (r1 9 + r2 3), cut round r3 ignored');
    assert.equal(s6.nightsPlayed, 2, 'cut standing not counted as played night');
  });

  it('splits the career record into regular season and finals', async () => {
    const tables = seededTables();
    tables.match_results.push({
      season_id: 6, round: 3, melee_match_id: 'm5',
      player1_id: 'P001', player2_id: 'P002', winner_id: 'P001', result: 'Alice won 2-0-0', is_bye: 0,
    });
    const result = await handleGetMyCareerStats({}, { DB: createMockDb(tables) }, aliceSession);

    assert.equal(result.record.matches.played, 3, 'regular-season matches only');
    assert.equal(result.record.sweeps.count, 1, 'the cut sweep is not a career sweep');

    assert.equal(result.finals.nights, 1);
    assert.equal(result.finals.matches.played, 1);
    assert.equal(result.finals.matches.wins, 1);
    assert.equal(result.finals.winPct, 100);
    assert.equal(result.finals.bestFinish, 1);
  });

  it('treats a side-event night as finals', async () => {
    const tables = seededTables();
    tables.melee_tournaments.push({
      melee_id: 104, season_id: 6, round: 4, name: 'SWU Wednesday league season 6 SIDE EVENT', date: '2026-07-22', phase: 'side',
    });
    tables.season_standings.push(
      { season_id: 6, round: 4, player_id: 'P001', wins: 1, losses: 1, draws: 0, match_points: 3, rank: 3 }
    );
    tables.match_results.push({
      season_id: 6, round: 4, melee_match_id: 'm6',
      player1_id: 'P001', player2_id: 'P002', winner_id: 'P002', result: 'Bob won 2-0-0', is_bye: 0,
    });
    const result = await handleGetMyCareerStats({}, { DB: createMockDb(tables) }, aliceSession);

    assert.equal(result.record.matches.played, 3, 'side-event match stays out of the career record');
    assert.equal(result.record.nights, 3, 'side-event night stays out of career nights');
    assert.equal(result.finals.nights, 2);
    assert.deepEqual(result.finals.matches, { played: 1, wins: 0, draws: 0, losses: 1 });
    assert.equal(result.finals.bestFinish, 1, 'best of cut 1st and side 3rd');
  });

  it('treats a night with no tournament row as regular season', async () => {
    const tables = seededTables();
    tables.melee_tournaments = tables.melee_tournaments.filter(t => !(t.season_id === 6 && t.round === 2));
    const result = await handleGetMyCareerStats({}, { DB: createMockDb(tables) }, aliceSession);

    assert.equal(result.record.nights, 3, 'unclassified night keeps its career night');
    assert.equal(result.record.matches.played, 3, 'unclassified night keeps its career matches');
    assert.equal(result.finals.nights, 1, 'only the cut night is finals');
  });

  it('keeps a finals-only career visible', async () => {
    const tables = seededTables();
    tables.season_standings = [
      { season_id: 6, round: 3, player_id: 'P001', wins: 4, losses: 0, draws: 0, match_points: 12, rank: 1 },
    ];
    const result = await handleGetMyCareerStats({}, { DB: createMockDb(tables) }, aliceSession);

    assert.equal(result.record.nights, 0);
    assert.equal(result.hasCareerData, true, 'finals history still counts as career data');
    assert.equal(result.finals.nights, 1);
  });

  it('counts only full nights won outright in the career undefeated total', async () => {
    const tables = seededTables();
    tables.season_standings = [
      { season_id: 6, round: 1, player_id: 'P001', wins: 4, losses: 0, draws: 0, match_points: 12, rank: 1 },
      { season_id: 6, round: 1, player_id: 'P002', wins: 2, losses: 2, draws: 0, match_points: 6, rank: 2 },
      { season_id: 6, round: 2, player_id: 'P001', wins: 2, losses: 0, draws: 0, match_points: 6, rank: 2 },
      { season_id: 6, round: 2, player_id: 'P002', wins: 4, losses: 0, draws: 0, match_points: 12, rank: 1 },
    ];
    tables.match_results = [];
    const result = await handleGetMyCareerStats({}, { DB: createMockDb(tables) }, aliceSession);

    assert.equal(result.record.nights, 2);
    assert.equal(result.record.undefeated, 1, 'round 2 is a short night — only round 1 counts');
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
    assert.deepEqual(result.peak, []);
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
