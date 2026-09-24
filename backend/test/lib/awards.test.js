import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assignStandardRanks, computeSchemer, computeAmbassador, computeChampion, computeBountyHunter, computeNewHopeClimbers, writePodiumBlock, AWARD_NAMES } from '../../src/lib/awards.js';
import { createMockDb } from '../helpers/mock-db.js';
import { basicTables, emptyTables } from '../helpers/fixtures.js';

describe('assignStandardRanks', () => {
  it('sorts items by score descending and assigns sequential ranks', () => {
    const items = [
      { id: 'A', score: 10 },
      { id: 'B', score: 30 },
      { id: 'C', score: 20 },
    ];
    const result = assignStandardRanks(items);
    assert.equal(result.length, 3);
    assert.equal(result[0].id, 'B');
    assert.equal(result[0].displayRank, 1);
    assert.equal(result[1].id, 'C');
    assert.equal(result[1].displayRank, 2);
    assert.equal(result[2].id, 'A');
    assert.equal(result[2].displayRank, 3);
  });

  it('assigns same rank to tied scores (1,1,3,4)', () => {
    const items = [
      { id: 'A', score: 30 },
      { id: 'B', score: 30 },
      { id: 'C', score: 20 },
      { id: 'D', score: 10 },
    ];
    const result = assignStandardRanks(items);
    assert.equal(result[0].displayRank, 1);
    assert.equal(result[1].displayRank, 1);
    assert.equal(result[2].displayRank, 3);
    assert.equal(result[3].displayRank, 4);
  });

  it('handles three-way tie for first', () => {
    const items = [
      { id: 'A', score: 50 },
      { id: 'B', score: 50 },
      { id: 'C', score: 50 },
      { id: 'D', score: 10 },
    ];
    const result = assignStandardRanks(items);
    assert.equal(result[0].displayRank, 1);
    assert.equal(result[1].displayRank, 1);
    assert.equal(result[2].displayRank, 1);
    assert.equal(result[3].displayRank, 4);
  });

  it('returns empty array for empty input', () => {
    assert.deepEqual(assignStandardRanks([]), []);
  });

  it('returns empty array for null input', () => {
    assert.deepEqual(assignStandardRanks(null), []);
  });

  it('returns empty array for undefined input', () => {
    assert.deepEqual(assignStandardRanks(undefined), []);
  });

  it('handles single item', () => {
    const result = assignStandardRanks([{ id: 'A', score: 5 }]);
    assert.equal(result.length, 1);
    assert.equal(result[0].displayRank, 1);
    assert.equal(result[0].id, 'A');
  });

  it('does not mutate the original array', () => {
    const items = [
      { id: 'A', score: 10 },
      { id: 'B', score: 20 },
    ];
    assignStandardRanks(items);
    assert.equal(items[0].id, 'A');
    assert.equal(items[1].id, 'B');
  });

  it('handles items with missing score as 0', () => {
    const items = [
      { id: 'A' },
      { id: 'B', score: 10 },
    ];
    const result = assignStandardRanks(items);
    assert.equal(result[0].id, 'B');
    assert.equal(result[0].displayRank, 1);
    assert.equal(result[1].id, 'A');
    assert.equal(result[1].displayRank, 2);
  });

  it('handles all same scores', () => {
    const items = [
      { id: 'A', score: 10 },
      { id: 'B', score: 10 },
      { id: 'C', score: 10 },
    ];
    const result = assignStandardRanks(items);
    assert.equal(result[0].displayRank, 1);
    assert.equal(result[1].displayRank, 1);
    assert.equal(result[2].displayRank, 1);
  });
});

describe('computeSchemer', () => {
  it('calls DB with correct SQL and returns an array', async () => {
    const db = createMockDb(basicTables());
    const result = await computeSchemer(db, 6);
    assert.ok(Array.isArray(result));
    assert.ok(result.length > 0);
    const calls = db.getCalls();
    assert.ok(calls.some(c => c.sql.includes('COUNT(DISTINCT leader_id)')));
    assert.ok(calls.some(c => c.sql.includes('votes')));
  });

  it('returns array for empty votes (mock returns count row)', async () => {
    const db = createMockDb(emptyTables());
    const result = await computeSchemer(db, 6);
    assert.ok(Array.isArray(result));
  });

  it('returns results with playerId and score properties', async () => {
    const db = createMockDb(basicTables());
    const result = await computeSchemer(db, 6);
    assert.ok(result.length > 0, 'should have at least one result');
    for (const entry of result) {
      assert.ok(entry.playerId, 'each entry should have a playerId');
      assert.ok(typeof entry.score === 'number', 'each entry should have a numeric score');
    }
  });

  it('returns more entries for players with more distinct leaders', async () => {
    const tables = basicTables();
    const db = createMockDb(tables);
    const result = await computeSchemer(db, 6);
    assert.ok(result.length >= 2, 'should have at least 2 players');
    const sorted = [...result].sort((a, b) => b.score - a.score);
    assert.ok(sorted[0].score >= sorted[sorted.length - 1].score, 'should be sorted by score desc');
  });
});

describe('computeAmbassador', () => {
  it('calls DB with correct SQL and returns an array', async () => {
    const db = createMockDb(basicTables());
    const result = await computeAmbassador(db, 6);
    assert.ok(Array.isArray(result));
    assert.ok(result.length > 0);
    const calls = db.getCalls();
    assert.ok(calls.some(c => c.sql.includes('votes')));
    assert.ok(calls.some(c => c.sql.includes('COUNT(*)')));
  });

  it('returns array for empty opponent_votes (mock returns count row)', async () => {
    const db = createMockDb(emptyTables());
    const result = await computeAmbassador(db, 6);
    assert.ok(Array.isArray(result));
  });

  it('returns results with playerId and score properties', async () => {
    const db = createMockDb(basicTables());
    const result = await computeAmbassador(db, 6);
    assert.ok(result.length > 0, 'should have at least one result');
    for (const entry of result) {
      assert.ok(entry.playerId, 'each entry should have a playerId');
      assert.ok(typeof entry.score === 'number', 'each entry should have a numeric score');
    }
  });

  it('returns more entries for players with more opponent votes', async () => {
    const db = createMockDb(basicTables());
    const result = await computeAmbassador(db, 6);
    assert.ok(result.length >= 2, 'should have at least 2 players');
    const sorted = [...result].sort((a, b) => b.score - a.score);
    assert.ok(sorted[0].score >= sorted[sorted.length - 1].score, 'should be sorted by score desc');
  });
});

describe('writePodiumBlock', () => {
  it('deletes existing award entries and inserts only provided rows', async () => {
    const db = createMockDb(basicTables());
    const entries = [
      { playerId: 'P001', score: 10 },
      { playerId: 'P002', score: 8 },
      { playerId: 'P003', score: 6 },
    ];
    await writePodiumBlock(db, 6, 'Galactic Schemer', entries);

    const store = db.getStore();
    const awardRows = store.awards.filter(
      r => r.award_name === 'Galactic Schemer' && r.season_id === 6
    );
    assert.equal(awardRows.length, 3);
    assert.equal(awardRows[0].player_id, 'P001');
    assert.equal(awardRows[0].score, 10);
    assert.equal(awardRows[1].player_id, 'P002');
    assert.equal(awardRows[1].score, 8);
    assert.equal(awardRows[2].player_id, 'P003');
    assert.equal(awardRows[2].score, 6);
  });

  it('does not affect other awards in the same season', async () => {
    const db = createMockDb(basicTables());
    const ambassadorBefore = db.getStore().awards.filter(
      r => r.award_name === 'Galactic Ambassador' && r.season_id === 6
    ).length;

    await writePodiumBlock(db, 6, 'Galactic Schemer', [
      { playerId: 'P001', score: 10 },
      { playerId: 'P002', score: 8 },
      { playerId: 'P003', score: 6 },
    ]);

    const ambassadorAfter = db.getStore().awards.filter(
      r => r.award_name === 'Galactic Ambassador' && r.season_id === 6
    ).length;
    assert.equal(ambassadorBefore, ambassadorAfter);
  });

  it('handles fewer than 5 entries without padding', async () => {
    const db = createMockDb(basicTables());
    const entries = [{ playerId: 'P001', score: 10 }];
    await writePodiumBlock(db, 6, 'Bounty Hunter', entries);

    const store = db.getStore();
    const awardRows = store.awards.filter(
      r => r.award_name === 'Bounty Hunter' && r.season_id === 6
    );
    assert.equal(awardRows.length, 1);
    assert.equal(awardRows[0].player_id, 'P001');
    assert.equal(awardRows[0].score, 10);
  });

  it('handles empty entries array — preserves existing data when block exists', async () => {
    const db = createMockDb(basicTables());
    const store = db.getStore();
    const existingCount = store.awards.filter(
      r => r.award_name === 'Galactic Schemer' && r.season_id === 6
    ).length;

    await writePodiumBlock(db, 6, 'Galactic Schemer', []);

    const awardRows = store.awards.filter(
      r => r.award_name === 'Galactic Schemer' && r.season_id === 6
    );
    assert.equal(awardRows.length, existingCount);
  });

  it('handles empty entries array — no rows written when no block exists', async () => {
    const tables = emptyTables();
    const db = createMockDb(tables);
    await writePodiumBlock(db, 6, 'Bounty Hunter', []);

    const store = db.getStore();
    const awardRows = store.awards.filter(
      r => r.award_name === 'Bounty Hunter' && r.season_id === 6
    );
    assert.equal(awardRows.length, 0);
  });

  it('writes all tie-boundary members beyond five entries (podium may exceed 3)', async () => {
    const db = createMockDb(basicTables());
    const entries = [
      { playerId: 'P001', score: 4 },
      { playerId: 'P002', score: 3 },
      { playerId: 'P003', score: 3 },
      { playerId: 'P004', score: 3 },
      { playerId: 'P005', score: 3 },
      { playerId: 'P006', score: 3 },
    ];
    await writePodiumBlock(db, 6, 'Galactic Schemer', entries);

    const store = db.getStore();
    const awardRows = store.awards.filter(
      r => r.award_name === 'Galactic Schemer' && r.season_id === 6
    );
    assert.equal(awardRows.length, 6, 'no silent cap — tied players are not arbitrarily dropped');
    assert.equal(awardRows[0].player_id, 'P001');
  });

  it('issues DELETE and INSERT calls to DB', async () => {
    const db = createMockDb(basicTables());
    db.clearCalls();
    await writePodiumBlock(db, 6, 'Galactic Schemer', [
      { playerId: 'P001', score: 10 },
      { playerId: 'P002', score: 8 },
      { playerId: 'P003', score: 6 },
    ]);

    const calls = db.getCalls();
    const deleteCalls = calls.filter(c => c.sql.toUpperCase().startsWith('DELETE'));
    const insertCalls = calls.filter(c => c.sql.toUpperCase().startsWith('INSERT'));
    assert.equal(deleteCalls.length, 1);
    assert.equal(insertCalls.length, 3);
  });
});

describe('AWARD_NAMES', () => {
  it('contains expected award names', () => {
    assert.ok(Array.isArray(AWARD_NAMES));
    assert.ok(AWARD_NAMES.includes('Galactic Ruler'));
    assert.ok(AWARD_NAMES.includes('Galactic Schemer'));
    assert.ok(AWARD_NAMES.includes('Galactic Ambassador'));
    assert.ok(AWARD_NAMES.includes('A New Hope'));
    assert.ok(AWARD_NAMES.includes('Bounty Hunter'));
  });

  it('has exactly 5 award names', () => {
    assert.equal(AWARD_NAMES.length, 5);
  });
});

describe('computeChampion', () => {
  it('returns rank 1 of chronologically last cut tournament', async () => {
    const tables = basicTables();
    tables.melee_tournaments = [
      { melee_id: 100, season_id: 6, round: 1, name: 'SWU Wednesday league season 6 15/7 (week 1)', date: '2026-06-15', phase: 'regular' },
      { melee_id: 101, season_id: 6, round: 12, name: 'SWU Wednesday league season 6 TOP 8', date: '2026-09-01', phase: 'cut' },
    ];
    tables.season_standings = [
      { season_id: 6, round: 1, player_id: 'P001', wins: 3, losses: 0, draws: 0, match_points: 9, rank: 1 },
      { season_id: 6, round: 12, player_id: 'P002', wins: 3, losses: 0, draws: 0, match_points: 9, rank: 1 },
      { season_id: 6, round: 12, player_id: 'P001', wins: 2, losses: 1, draws: 0, match_points: 6, rank: 2 },
    ];
    const db = createMockDb(tables);

    const result = await computeChampion(db, 6);
    assert.equal(result.length, 1);
    assert.equal(result[0].playerId, 'P002');
    assert.equal(result[0].score, 1);
  });

  it('returns empty array when no cut tournaments exist', async () => {
    const tables = basicTables();
    tables.melee_tournaments = [
      { melee_id: 100, season_id: 6, round: 1, name: 'SWU Wednesday league season 6 15/7 (week 1)', date: '2026-06-15', phase: 'regular' },
    ];
    const db = createMockDb(tables);

    const result = await computeChampion(db, 6);
    assert.equal(result.length, 0);
  });

  it('handles ties at rank 1 in cut tournament', async () => {
    const tables = basicTables();
    tables.melee_tournaments = [
      { melee_id: 101, season_id: 6, round: 12, name: 'SWU Wednesday league season 6 TOP 8', date: '2026-09-01', phase: 'cut' },
    ];
    tables.season_standings = [
      { season_id: 6, round: 12, player_id: 'P001', wins: 3, losses: 0, draws: 0, match_points: 9, rank: 1 },
      { season_id: 6, round: 12, player_id: 'P002', wins: 3, losses: 0, draws: 0, match_points: 9, rank: 1 },
    ];
    const db = createMockDb(tables);

    const result = await computeChampion(db, 6);
    assert.equal(result.length, 2);
    assert.ok(result.some(e => e.playerId === 'P001'));
    assert.ok(result.some(e => e.playerId === 'P002'));
  });
});

describe('computeBountyHunter', () => {
  it('returns non-bye regular-season wins vs previous season top-4 from derived table', async () => {
    const tables = basicTables();
    tables.seasons = [
      { id: 5, name: 'Season 5', created_date: '2026-01-15', length: 3, top_results: 2 },
      { id: 6, name: 'Season 6', created_date: '2026-06-03', length: 3, top_results: 2 },
    ];
    tables.melee_tournaments = [
      { melee_id: 501, season_id: 5, round: 1, name: 'S5 week 1', date: '2026-01-01', phase: 'regular' },
      { melee_id: 502, season_id: 5, round: 2, name: 'S5 week 2', date: '2026-01-08', phase: 'regular' },
      { melee_id: 503, season_id: 5, round: 3, name: 'S5 week 3', date: '2026-01-15', phase: 'regular' },
      { melee_id: 601, season_id: 6, round: 1, name: 'S6 week 1', date: '2026-06-01', phase: 'regular' },
      { melee_id: 602, season_id: 6, round: 2, name: 'S6 TOP 4', date: '2026-06-08', phase: 'cut' },
    ];
    tables.season_standings = [
      { season_id: 5, round: 1, player_id: 'P001', wins: 3, losses: 0, draws: 0, match_points: 9, rank: 1 },
      { season_id: 5, round: 1, player_id: 'P002', wins: 2, losses: 1, draws: 0, match_points: 6, rank: 2 },
      { season_id: 5, round: 1, player_id: 'P003', wins: 2, losses: 1, draws: 0, match_points: 6, rank: 3 },
      { season_id: 5, round: 1, player_id: 'P004', wins: 1, losses: 2, draws: 0, match_points: 3, rank: 4 },
      { season_id: 5, round: 1, player_id: 'P005', wins: 0, losses: 3, draws: 0, match_points: 0, rank: 5 },
      { season_id: 5, round: 2, player_id: 'P001', wins: 3, losses: 0, draws: 0, match_points: 9, rank: 1 },
      { season_id: 5, round: 2, player_id: 'P002', wins: 3, losses: 0, draws: 0, match_points: 9, rank: 2 },
      { season_id: 5, round: 2, player_id: 'P003', wins: 2, losses: 1, draws: 0, match_points: 6, rank: 3 },
      { season_id: 5, round: 2, player_id: 'P004', wins: 1, losses: 2, draws: 0, match_points: 3, rank: 4 },
      { season_id: 5, round: 2, player_id: 'P005', wins: 0, losses: 3, draws: 0, match_points: 0, rank: 5 },
      { season_id: 5, round: 3, player_id: 'P001', wins: 2, losses: 1, draws: 0, match_points: 6, rank: 2 },
      { season_id: 5, round: 3, player_id: 'P002', wins: 3, losses: 0, draws: 0, match_points: 9, rank: 1 },
      { season_id: 5, round: 3, player_id: 'P003', wins: 2, losses: 1, draws: 0, match_points: 6, rank: 3 },
      { season_id: 5, round: 3, player_id: 'P004', wins: 1, losses: 2, draws: 0, match_points: 3, rank: 4 },
      { season_id: 5, round: 3, player_id: 'P005', wins: 0, losses: 3, draws: 0, match_points: 0, rank: 5 },
    ];
    tables.match_results = [
      { id: 1, season_id: 6, round: 1, melee_match_id: 'm1', player1_id: 'P005', player2_id: 'P001', winner_id: 'P005', result: '2-0', is_bye: 0 },
      { id: 2, season_id: 6, round: 1, melee_match_id: 'm2', player1_id: 'P005', player2_id: 'P002', winner_id: 'P005', result: '2-0', is_bye: 0 },
      { id: 3, season_id: 6, round: 1, melee_match_id: 'm3', player1_id: 'P005', player2_id: 'P003', winner_id: 'P005', result: '2-0', is_bye: 0 },
      { id: 4, season_id: 6, round: 2, melee_match_id: 'm4', player1_id: 'P005', player2_id: 'P001', winner_id: 'P005', result: '2-0', is_bye: 0 },
    ];
    const db = createMockDb(tables);

    const result = await computeBountyHunter(db, 6);
    assert.equal(result.length, 1);
    assert.equal(result[0].playerId, 'P005');
    assert.equal(result[0].score, 3);
  });

  it('excludes cut/side matches from count', async () => {
    const tables = basicTables();
    tables.seasons = [
      { id: 5, name: 'Season 5', created_date: '2026-01-15', length: 1, top_results: 1 },
      { id: 6, name: 'Season 6', created_date: '2026-06-03', length: 1, top_results: 1 },
    ];
    tables.melee_tournaments = [
      { melee_id: 501, season_id: 5, round: 1, name: 'S5 week 1', date: '2026-01-01', phase: 'regular' },
      { melee_id: 601, season_id: 6, round: 1, name: 'S6 week 1', date: '2026-06-01', phase: 'regular' },
      { melee_id: 602, season_id: 6, round: 2, name: 'S6 TOP 4', date: '2026-06-08', phase: 'cut' },
    ];
    tables.season_standings = [
      { season_id: 5, round: 1, player_id: 'P001', wins: 3, losses: 0, draws: 0, match_points: 9, rank: 1 },
    ];
    tables.match_results = [
      { id: 1, season_id: 6, round: 1, melee_match_id: 'm1', player1_id: 'P002', player2_id: 'P001', winner_id: 'P002', result: '2-0', is_bye: 0 },
      { id: 2, season_id: 6, round: 2, melee_match_id: 'm2', player1_id: 'P002', player2_id: 'P001', winner_id: 'P002', result: '2-0', is_bye: 0 },
    ];
    const db = createMockDb(tables);

    const result = await computeBountyHunter(db, 6);
    assert.equal(result.length, 1);
    assert.equal(result[0].playerId, 'P002');
    assert.equal(result[0].score, 1);
  });

  it('returns empty array for S1 (no previous season)', async () => {
    const tables = basicTables();
    tables.seasons = [
      { id: 1, name: 'Season 1', created_date: '2025-01-01', length: 10, top_results: 7 },
    ];
    const db = createMockDb(tables);

    const result = await computeBountyHunter(db, 1);
    assert.equal(result.length, 0);
  });

  it('excludes bye wins from count', async () => {
    const tables = basicTables();
    tables.seasons = [
      { id: 5, name: 'Season 5', created_date: '2026-01-15', length: 1, top_results: 1 },
      { id: 6, name: 'Season 6', created_date: '2026-06-03', length: 1, top_results: 1 },
    ];
    tables.melee_tournaments = [
      { melee_id: 501, season_id: 5, round: 1, name: 'S5 week 1', date: '2026-01-01', phase: 'regular' },
      { melee_id: 601, season_id: 6, round: 1, name: 'S6 week 1', date: '2026-06-01', phase: 'regular' },
    ];
    tables.season_standings = [
      { season_id: 5, round: 1, player_id: 'P001', wins: 3, losses: 0, draws: 0, match_points: 9, rank: 1 },
    ];
    tables.match_results = [
      { id: 1, season_id: 6, round: 1, melee_match_id: 'm1', player1_id: 'P002', player2_id: 'P001', winner_id: 'P002', result: '2-0', is_bye: 1 },
    ];
    const db = createMockDb(tables);

    const result = await computeBountyHunter(db, 6);
    assert.equal(result.length, 0);
  });
});

describe('computeNewHopeClimbers', () => {
  function nhTables({ rounds, standings }) {
    const t = basicTables();
    t.melee_tournaments = rounds;
    t.season_standings = standings;
    return t;
  }

  function standing(playerId, round, matchPoints) {
    return { season_id: 6, round, player_id: playerId, wins: 0, losses: 0, draws: 0, match_points: matchPoints, rank: 1 };
  }

  function regular(round) {
    return { melee_id: 700 + round, season_id: 6, round, name: `S6 w${round}`, date: '2026-07-01', phase: 'regular' };
  }

  // seasonLength 11 → midRound 5

  it('computes climb as mid rank minus final rank, keeping only positive climbers', async () => {
    const db = createMockDb(nhTables({
      rounds: [regular(1), regular(2), regular(3)],
      standings: [standing('P1', 1, 30), standing('P2', 2, 20), standing('P3', 3, 10)],
    }));
    const finalRankMap = new Map([['P1', 3], ['P2', 2], ['P3', 1]]);

    const climbers = await computeNewHopeClimbers(db, 6, finalRankMap, 11);
    // P1 went 1 → 3 (fell, excluded); P2 2 → 2 (0, excluded); P3 3 → 1 = climb 2.
    assert.deepEqual(climbers, [{ playerId: 'P3', climb: 2 }]);
  });

  it('requires presence in BOTH snapshots (players missing from final are excluded)', async () => {
    const db = createMockDb(nhTables({
      rounds: [regular(1), regular(2)],
      standings: [standing('P1', 1, 30), standing('P2', 2, 20), standing('P4', 1, 9)],
    }));
    const finalRankMap = new Map([['P1', 4], ['P2', 2]]);

    const climbers = await computeNewHopeClimbers(db, 6, finalRankMap, 11);
    assert.ok(!climbers.some(c => c.playerId === 'P4'), 'P4 absent from final table → no climb entry');
  });

  it('mid snapshot uses RAW accumulated points, not per-round best', async () => {
    const db = createMockDb(nhTables({
      rounds: [regular(1), regular(2)],
      standings: [standing('P1', 1, 30), standing('P2', 1, 20), standing('P2', 2, 15)],
    }));
    const finalRankMap = new Map([['P1', 1], ['P2', 4]]);

    const climbers = await computeNewHopeClimbers(db, 6, finalRankMap, 11);
    // Raw sums: P2=35 mid rank 1, P1=30 mid rank 2 → P1 climbs 2→1.
    // Per-round best (P1=30, P2=20) would put P1 mid rank 1 → climb 0 → [].
    assert.deepEqual(climbers, [{ playerId: 'P1', climb: 1 }]);
  });

  it('rounds beyond midRound do not enter the mid snapshot', async () => {
    const db = createMockDb(nhTables({
      rounds: [regular(1), regular(2), regular(6)],
      standings: [standing('P1', 1, 10), standing('P1', 6, 100), standing('P2', 2, 20)],
    }));
    const finalRankMap = new Map([['P1', 1], ['P2', 2]]);

    const climbers = await computeNewHopeClimbers(db, 6, finalRankMap, 11);
    // mid only counts round ≤ 5: P2=20 rank 1, P1=10 rank 2 → P1 climbs 1.
    // (round 6's 100 pts must NOT make P1 mid leader → climb 0)
    assert.deepEqual(climbers, [{ playerId: 'P1', climb: 1 }]);
  });

  it('cut/side rounds ≤ midRound are excluded from the mid snapshot', async () => {
    const db = createMockDb(nhTables({
      rounds: [regular(1), regular(2), { melee_id: 999, season_id: 6, round: 4, name: 'TOP 4', date: '2026-07-01', phase: 'cut' }],
      standings: [standing('P1', 1, 10), standing('P1', 4, 100), standing('P2', 2, 20)],
    }));
    const finalRankMap = new Map([['P1', 1], ['P2', 2]]);

    const climbers = await computeNewHopeClimbers(db, 6, finalRankMap, 11);
    assert.deepEqual(climbers, [{ playerId: 'P1', climb: 1 }],
      'the cut round at r4 must not inflate P1 into mid leadership');
  });

  it('caps at top 3 climbers', async () => {
    const db = createMockDb(nhTables({
      rounds: [regular(1), regular(2), regular(3), regular(4)],
      standings: [standing('P1', 1, 50), standing('P2', 2, 40), standing('P3', 3, 30), standing('P4', 4, 20), standing('P5', 4, 10)],
    }));
    const finalRankMap = new Map([['P1', 6], ['P2', 5], ['P3', 1], ['P4', 2], ['P5', 3]]);

    const climbers = await computeNewHopeClimbers(db, 6, finalRankMap, 11);
    // climbs: P3: 3→1=2, P4: 4→2=2, P5: 5→3=2, P1: 1→6=-5, P2: 2→5=-3 → 3 climbers exactly at cap.
    assert.equal(climbers.length, 3);
    // add a fourth: shift P2 up too
    db.getStore().season_standings.push({ season_id: 6, round: 3, player_id: 'P6', wins: 0, losses: 0, draws: 0, match_points: 25, rank: 1 });
    db.getStore().melee_tournaments.push({ melee_id: 704, season_id: 6, round: 3, name: 'S6 w3b', date: '2026-07-01', phase: 'regular' });
    const withSix = await computeNewHopeClimbers(db, 6, new Map([['P1', 7], ['P2', 6], ['P3', 1], ['P4', 2], ['P5', 3], ['P6', 4]]), 11);
    // mid ranks: P1=1,P2=2,P3=3,P6=4,P4=5,P5=6 → climbs: P3: 3-1=2, P4: 5-2=3, P5: 6-3=3,
    // P6: 4-4=0, others negative → sorted desc: P4@3, P5@3, P3@2 (P6 excluded, no climb).
    assert.equal(withSix.length, 3, 'never more than 3 entries');
    assert.deepEqual(withSix.map(c => c.playerId), ['P4', 'P5', 'P3']);
  });

  it('ties on climb keep deterministic order (best mid rank first)', async () => {
    const db = createMockDb(nhTables({
      rounds: [regular(1), regular(2), regular(3)],
      standings: [standing('P1', 1, 30), standing('P2', 2, 20), standing('P3', 3, 10)],
    }));
    const finalRankMap = new Map([['P1', 4], ['P2', 1], ['P3', 2]]);

    const climbers = await computeNewHopeClimbers(db, 6, finalRankMap, 11);
    // P2: 2→1 climb 1, P3: 3→2 climb 1 (tie) → mid-rank order preserved: P2 before P3.
    assert.deepEqual(climbers.map(c => c.playerId), ['P2', 'P3']);
  });

  it('tied mid points get consecutive mid ranks (historical quirk, unchanged)', async () => {
    const db = createMockDb(nhTables({
      rounds: [regular(1)],
      standings: [standing('P1', 1, 20), standing('P2', 1, 20)],
    }));
    const finalRankMap = new Map([['P1', 3], ['P2', 1]]);

    const climbers = await computeNewHopeClimbers(db, 6, finalRankMap, 11);
    // P1 gets mid rank 1, P2 rank 2 (consecutive, NOT shared):
    // P1: 1-3=-2 excluded; P2: 2-1=1 → sole climber.
    // Shared-rank mid semantics would give both mid rank 1 → zero climbers.
    assert.deepEqual(climbers, [{ playerId: 'P2', climb: 1 }]);
  });

  it('returns empty array when the season has no mid-round standings', async () => {
    const db = createMockDb(nhTables({
      rounds: [regular(1)],
      standings: [],
    }));
    const climbers = await computeNewHopeClimbers(db, 6, new Map([['P1', 1]]), 11);
    assert.deepEqual(climbers, []);
  });
});
