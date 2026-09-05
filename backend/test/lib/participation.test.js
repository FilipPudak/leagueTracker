import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMockDb } from '../helpers/mock-db.js';
import { basicTables, emptyTables } from '../helpers/fixtures.js';
import {
  getCompliance,
  getStreaks,
  getRaffleTickets,
  getWeeklyParticipation,
  getSeasonParticipation,
} from '../../src/lib/participation.js';

function makeStreakTables() {
  const now = new Date().toISOString();
  return {
    settings: [],
    players: [
      { id: 'P100', name: 'FullVoter', melee_name: 'full', email: 'full@test.com', active: 1 },
      { id: 'P101', name: 'PartialVoter', melee_name: 'partial', email: 'partial@test.com', active: 1 },
      { id: 'P102', name: 'NoVoter', melee_name: 'novote', email: 'novote@test.com', active: 1 },
      { id: 'P103', name: 'TwoTickets', melee_name: 'two', email: 'two@test.com', active: 1 },
      { id: 'P104', name: 'ZeroTickets', melee_name: 'zero', email: 'zero@test.com', active: 1 },
    ],
    leaders: [],
    seasons: [],
    sessions: [],
    leader_votes: [
      { timestamp: now, season_id: 7, week: 1, player_id: 'P100', leader_id: '1' },
      { timestamp: now, season_id: 7, week: 2, player_id: 'P100', leader_id: '2' },
      { timestamp: now, season_id: 7, week: 3, player_id: 'P100', leader_id: '3' },
      { timestamp: now, season_id: 7, week: 4, player_id: 'P100', leader_id: '1' },
      { timestamp: now, season_id: 7, week: 5, player_id: 'P100', leader_id: '2' },
      { timestamp: now, season_id: 7, week: 1, player_id: 'P101', leader_id: '1' },
      { timestamp: now, season_id: 7, week: 2, player_id: 'P101', leader_id: '2' },
      { timestamp: now, season_id: 7, week: 5, player_id: 'P101', leader_id: '3' },
      { timestamp: now, season_id: 7, week: 2, player_id: 'P103', leader_id: '1' },
      { timestamp: now, season_id: 7, week: 2, player_id: 'P103', leader_id: '2' },
    ],
    opponent_votes: [],
    awards: [],
    attendance: [
      { season_id: 7, week: 1, player_id: 'P100' },
      { season_id: 7, week: 2, player_id: 'P100' },
      { season_id: 7, week: 3, player_id: 'P100' },
      { season_id: 7, week: 4, player_id: 'P100' },
      { season_id: 7, week: 5, player_id: 'P100' },
      { season_id: 7, week: 1, player_id: 'P101' },
      { season_id: 7, week: 2, player_id: 'P101' },
      { season_id: 7, week: 3, player_id: 'P101' },
      { season_id: 7, week: 4, player_id: 'P101' },
      { season_id: 7, week: 5, player_id: 'P101' },
      { season_id: 7, week: 1, player_id: 'P102' },
      { season_id: 7, week: 2, player_id: 'P102' },
      { season_id: 7, week: 3, player_id: 'P102' },
    ],
  };
}

describe('getCompliance', () => {
  it('returns compliance data structure for a player with attendance', async () => {
    const db = createMockDb(makeStreakTables());
    const result = await getCompliance(db, 7, 'P100');
    assert.ok('weeksVoted' in result);
    assert.ok('weeksAttended' in result);
    assert.ok('compliancePct' in result);
    assert.equal(typeof result.weeksVoted, 'number');
    assert.equal(typeof result.weeksAttended, 'number');
    assert.equal(typeof result.compliancePct, 'number');
  });

  it('returns 0s when player has no attendance', async () => {
    const db = createMockDb(makeStreakTables());
    const result = await getCompliance(db, 7, 'P999');
    assert.equal(result.weeksVoted, 0);
    assert.equal(result.weeksAttended, 0);
    assert.equal(result.compliancePct, 0);
  });

  it('returns 0s with empty tables', async () => {
    const db = createMockDb(emptyTables());
    const result = await getCompliance(db, 6, 'P001');
    assert.equal(result.weeksVoted, 0);
    assert.equal(result.weeksAttended, 0);
    assert.equal(result.compliancePct, 0);
  });
});

describe('getStreaks', () => {
  it('returns full streak when player voted every attended week', async () => {
    const db = createMockDb(makeStreakTables());
    const result = await getStreaks(db, 7, 'P100');
    assert.equal(result.currentStreak, 5);
    assert.equal(result.bestStreak, 5);
  });

  it('returns 0 streaks when player never voted', async () => {
    const db = createMockDb(makeStreakTables());
    const result = await getStreaks(db, 7, 'P102');
    assert.equal(result.currentStreak, 0);
    assert.equal(result.bestStreak, 0);
  });

  it('returns 0 streaks when player has no attendance', async () => {
    const db = createMockDb(makeStreakTables());
    const result = await getStreaks(db, 7, 'P999');
    assert.equal(result.currentStreak, 0);
    assert.equal(result.bestStreak, 0);
  });

  it('returns 0 streaks with empty tables', async () => {
    const db = createMockDb(emptyTables());
    const result = await getStreaks(db, 6, 'P001');
    assert.equal(result.currentStreak, 0);
    assert.equal(result.bestStreak, 0);
  });

  it('returns an object with currentStreak and bestStreak keys', async () => {
    const db = createMockDb(makeStreakTables());
    const result = await getStreaks(db, 7, 'P101');
    assert.ok('currentStreak' in result);
    assert.ok('bestStreak' in result);
    assert.equal(typeof result.currentStreak, 'number');
    assert.equal(typeof result.bestStreak, 'number');
  });

  it('bestStreak is never less than currentStreak', async () => {
    const db = createMockDb(makeStreakTables());
    const result = await getStreaks(db, 7, 'P101');
    assert.ok(result.bestStreak >= result.currentStreak);
  });
});

describe('getRaffleTickets', () => {
  it('returns vote count as ticket count', async () => {
    const db = createMockDb(makeStreakTables());
    const result = await getRaffleTickets(db, 7, 'P103');
    assert.equal(result, 2);
  });

  it('returns 5 for player with 5 votes', async () => {
    const db = createMockDb(makeStreakTables());
    const result = await getRaffleTickets(db, 7, 'P100');
    assert.equal(result, 5);
  });

  it('returns 0 when player has no votes', async () => {
    const db = createMockDb(makeStreakTables());
    const result = await getRaffleTickets(db, 7, 'P102');
    assert.equal(result, 0);
  });

  it('returns 0 for non-existent player', async () => {
    const db = createMockDb(makeStreakTables());
    const result = await getRaffleTickets(db, 7, 'P999');
    assert.equal(result, 0);
  });

  it('returns 0 with empty tables', async () => {
    const db = createMockDb(emptyTables());
    const result = await getRaffleTickets(db, 6, 'P001');
    assert.equal(result, 0);
  });

  it('returns 0 for different season with no votes', async () => {
    const db = createMockDb(makeStreakTables());
    const result = await getRaffleTickets(db, 99, 'P100');
    assert.equal(result, 0);
  });
});

describe('getWeeklyParticipation', () => {
  it('returns object with voted and total keys', async () => {
    const db = createMockDb(makeStreakTables());
    const result = await getWeeklyParticipation(db, 7, 1);
    assert.ok('voted' in result);
    assert.ok('total' in result);
    assert.equal(typeof result.voted, 'number');
    assert.equal(typeof result.total, 'number');
  });

  it('returns correct total from active players', async () => {
    const db = createMockDb(makeStreakTables());
    const result = await getWeeklyParticipation(db, 7, 1);
    assert.equal(result.total, 5);
  });

  it('returns 0 voted for week with no votes', async () => {
    const db = createMockDb(makeStreakTables());
    const result = await getWeeklyParticipation(db, 7, 99);
    assert.equal(result.voted, 0);
    assert.equal(result.total, 5);
  });

  it('returns 0s with empty tables', async () => {
    const db = createMockDb(emptyTables());
    const result = await getWeeklyParticipation(db, 6, 1);
    assert.equal(result.voted, 0);
    assert.equal(result.total, 0);
  });

  it('voted count is a non-negative integer', async () => {
    const db = createMockDb(makeStreakTables());
    const result = await getWeeklyParticipation(db, 7, 2);
    assert.ok(result.voted >= 0);
    assert.equal(Number.isInteger(result.voted), true);
  });
});

describe('getSeasonParticipation', () => {
  it('returns correct structure with totalPlayers', async () => {
    const db = createMockDb(makeStreakTables());
    const result = await getSeasonParticipation(db, 7);
    assert.ok('participationPct' in result);
    assert.ok('totalPlayers' in result);
    assert.ok('playersWhoVoted' in result);
    assert.equal(typeof result.participationPct, 'number');
    assert.equal(typeof result.totalPlayers, 'number');
    assert.equal(typeof result.playersWhoVoted, 'number');
  });

  it('returns correct totalPlayers from active players', async () => {
    const db = createMockDb(makeStreakTables());
    const result = await getSeasonParticipation(db, 7);
    assert.equal(result.totalPlayers, 5);
  });

  it('returns 0s with empty tables', async () => {
    const db = createMockDb(emptyTables());
    const result = await getSeasonParticipation(db, 6);
    assert.equal(result.participationPct, 0);
    assert.equal(result.totalPlayers, 0);
    assert.equal(result.playersWhoVoted, 0);
  });

  it('returns 0 participationPct when no players exist', async () => {
    const db = createMockDb(emptyTables());
    const result = await getSeasonParticipation(db, 99);
    assert.equal(result.participationPct, 0);
  });

  it('participationPct is between 0 and 100', async () => {
    const db = createMockDb(makeStreakTables());
    const result = await getSeasonParticipation(db, 7);
    assert.ok(result.participationPct >= 0);
    assert.ok(result.participationPct <= 100);
  });
});
