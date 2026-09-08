import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { assignStandardRanks, computeSchemer, computeAmbassador, computeChampion, computeBountyHunter, writePodiumBlock, AWARD_NAMES } from '../../src/lib/awards.js';
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
    assert.ok(calls.some(c => c.sql.includes('leader_votes')));
  });

  it('returns array for empty leader_votes (mock returns count row)', async () => {
    const db = createMockDb(emptyTables());
    const result = await computeSchemer(db, 6);
    assert.ok(Array.isArray(result));
  });
});

describe('computeAmbassador', () => {
  it('calls DB with correct SQL and returns an array', async () => {
    const db = createMockDb(basicTables());
    const result = await computeAmbassador(db, 6);
    assert.ok(Array.isArray(result));
    assert.ok(result.length > 0);
    const calls = db.getCalls();
    assert.ok(calls.some(c => c.sql.includes('opponent_votes')));
    assert.ok(calls.some(c => c.sql.includes('COUNT(*)')));
  });

  it('returns array for empty opponent_votes (mock returns count row)', async () => {
    const db = createMockDb(emptyTables());
    const result = await computeAmbassador(db, 6);
    assert.ok(Array.isArray(result));
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

  it('truncates entries to top 5', async () => {
    const db = createMockDb(basicTables());
    const entries = [
      { playerId: 'P001', score: 10 },
      { playerId: 'P002', score: 8 },
      { playerId: 'P003', score: 6 },
      { playerId: 'P004', score: 4 },
    ];
    await writePodiumBlock(db, 6, 'Galactic Schemer', entries);

    const store = db.getStore();
    const awardRows = store.awards.filter(
      r => r.award_name === 'Galactic Schemer' && r.season_id === 6
    );
    assert.equal(awardRows.length, 4);
    assert.equal(awardRows[2].player_id, 'P003');
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
  it('returns non-bye wins vs previous season top-4', async () => {
    const tables = basicTables();
    tables.seasons = [
      { id: 5, name: 'Season 5', created_date: '2026-01-15', length: 11, top_results: 7 },
      { id: 6, name: 'Season 6', created_date: '2026-06-03', length: 11, top_results: 7 },
    ];
    tables.season_standings = [
      { season_id: 5, round: 11, player_id: 'P001', wins: 3, losses: 0, draws: 0, match_points: 9, rank: 1 },
      { season_id: 5, round: 11, player_id: 'P002', wins: 3, losses: 0, draws: 0, match_points: 9, rank: 2 },
      { season_id: 5, round: 11, player_id: 'P003', wins: 3, losses: 0, draws: 0, match_points: 9, rank: 3 },
      { season_id: 5, round: 11, player_id: 'P004', wins: 3, losses: 0, draws: 0, match_points: 9, rank: 4 },
      { season_id: 5, round: 11, player_id: 'P005', wins: 2, losses: 1, draws: 0, match_points: 6, rank: 5 },
    ];
    tables.match_results = [
      { id: 1, season_id: 6, round: 1, melee_match_id: 'm1', player1_id: 'P001', player2_id: 'P005', winner_id: 'P001', result: '2-0', is_bye: 0 },
      { id: 2, season_id: 6, round: 1, melee_match_id: 'm2', player1_id: 'P001', player2_id: 'P002', winner_id: 'P001', result: '2-1', is_bye: 0 },
      { id: 3, season_id: 6, round: 1, melee_match_id: 'm3', player1_id: 'P001', player2_id: 'P003', winner_id: 'P001', result: '2-0', is_bye: 0 },
      { id: 4, season_id: 6, round: 1, melee_match_id: 'm4', player1_id: 'P001', player2_id: 'P004', winner_id: 'P001', result: '2-0', is_bye: 0 },
      { id: 5, season_id: 6, round: 1, melee_match_id: 'm5', player1_id: 'P001', player2_id: 'P002', winner_id: 'P001', result: '2-0', is_bye: 1 },
    ];
    const db = createMockDb(tables);

    const result = await computeBountyHunter(db, 6);
    assert.equal(result.length, 1);
    assert.equal(result[0].playerId, 'P001');
    assert.equal(result[0].score, 4);
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
      { id: 5, name: 'Season 5', created_date: '2026-01-15', length: 11, top_results: 7 },
      { id: 6, name: 'Season 6', created_date: '2026-06-03', length: 11, top_results: 7 },
    ];
    tables.season_standings = [
      { season_id: 5, round: 11, player_id: 'P001', wins: 3, losses: 0, draws: 0, match_points: 9, rank: 1 },
    ];
    tables.match_results = [
      { id: 1, season_id: 6, round: 1, melee_match_id: 'm1', player1_id: 'P002', player2_id: 'P001', winner_id: 'P002', result: '2-0', is_bye: 1 },
    ];
    const db = createMockDb(tables);

    const result = await computeBountyHunter(db, 6);
    assert.equal(result.length, 0);
  });
});
