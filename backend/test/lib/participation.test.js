import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMockDb } from '../helpers/mock-db.js';
import { basicTables, emptyTables } from '../helpers/fixtures.js';
import {
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
    votes: [
      { id: 1, timestamp: now, updated_at: null, season_id: 7, week: 1, player_id: 'P100', leader_id: '1', opponent_id: 'P101' },
      { id: 2, timestamp: now, updated_at: null, season_id: 7, week: 2, player_id: 'P100', leader_id: '2', opponent_id: 'P102' },
      { id: 3, timestamp: now, updated_at: null, season_id: 7, week: 3, player_id: 'P100', leader_id: '3', opponent_id: 'P101' },
      { id: 4, timestamp: now, updated_at: null, season_id: 7, week: 4, player_id: 'P100', leader_id: '1', opponent_id: 'P102' },
      { id: 5, timestamp: now, updated_at: null, season_id: 7, week: 5, player_id: 'P100', leader_id: '2', opponent_id: 'P101' },
      { id: 6, timestamp: now, updated_at: null, season_id: 7, week: 1, player_id: 'P101', leader_id: '1', opponent_id: 'P100' },
      { id: 7, timestamp: now, updated_at: null, season_id: 7, week: 2, player_id: 'P101', leader_id: '2', opponent_id: 'P100' },
      { id: 8, timestamp: now, updated_at: null, season_id: 7, week: 5, player_id: 'P101', leader_id: '3', opponent_id: 'P100' },
      { id: 9, timestamp: now, updated_at: null, season_id: 7, week: 2, player_id: 'P103', leader_id: '1', opponent_id: 'P100' },
      { id: 10, timestamp: now, updated_at: null, season_id: 7, week: 2, player_id: 'P103', leader_id: '2', opponent_id: 'P100' },
    ],
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
    melee_tournaments: [
      { season_id: 7, round: 1, phase: 'regular' },
      { season_id: 7, round: 2, phase: 'regular' },
      { season_id: 7, round: 3, phase: 'regular' },
      { season_id: 7, round: 4, phase: 'regular' },
      { season_id: 7, round: 5, phase: 'regular' },
    ],
  };
}

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

  it('cut/side attendance does not count toward streak', async () => {
    const now = new Date().toISOString();
    const db = createMockDb({
      settings: [],
      players: [{ id: 'P200', name: 'CutPlayer', melee_name: 'cut', email: 'cut@test.com', active: 1 }],
      leaders: [],
      seasons: [],
      sessions: [],
      votes: [
        { id: 1, timestamp: now, updated_at: null, season_id: 8, week: 1, player_id: 'P200', leader_id: '1', opponent_id: null },
        { id: 2, timestamp: now, updated_at: null, season_id: 8, week: 2, player_id: 'P200', leader_id: '1', opponent_id: null },
      ],
      awards: [],
      attendance: [
        { season_id: 8, week: 1, player_id: 'P200' },
        { season_id: 8, week: 2, player_id: 'P200' },
      ],
      melee_tournaments: [
        { season_id: 8, round: 1, phase: 'cut' },
        { season_id: 8, round: 2, phase: 'side' },
      ],
    });
    const result = await getStreaks(db, 8, 'P200');
    assert.equal(result.currentStreak, 0, 'cut/side attendance should not form a streak');
    assert.equal(result.bestStreak, 0);
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

  it('returns correct total from attendance for week', async () => {
    const db = createMockDb(makeStreakTables());
    const result = await getWeeklyParticipation(db, 7, 1);
    assert.equal(result.total, 3);
  });

  it('returns 0 voted and 0 total for week with no attendance', async () => {
    const db = createMockDb(makeStreakTables());
    const result = await getWeeklyParticipation(db, 7, 99);
    assert.equal(result.voted, 0);
    assert.equal(result.total, 0);
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
  it('returns correct structure with totalPlayers and totalVotes', async () => {
    const db = createMockDb(makeStreakTables());
    const result = await getSeasonParticipation(db, 7);
    assert.ok('participationPct' in result);
    assert.ok('totalPlayers' in result);
    assert.ok('playersWhoVoted' in result);
    assert.ok('totalVotes' in result);
    assert.equal(typeof result.participationPct, 'number');
    assert.equal(typeof result.totalPlayers, 'number');
    assert.equal(typeof result.playersWhoVoted, 'number');
    assert.equal(typeof result.totalVotes, 'number');
  });

  it('returns correct totalPlayers from players with attendance', async () => {
    const db = createMockDb(makeStreakTables());
    const result = await getSeasonParticipation(db, 7);
    assert.equal(result.totalPlayers, 3);
  });

  it('returns correct totalVotes count', async () => {
    const db = createMockDb(makeStreakTables());
    const result = await getSeasonParticipation(db, 7);
    assert.equal(result.totalVotes, 10);
  });

  it('returns 0s with empty tables', async () => {
    const db = createMockDb(emptyTables());
    const result = await getSeasonParticipation(db, 6);
    assert.equal(result.participationPct, 0);
    assert.equal(result.totalPlayers, 0);
    assert.equal(result.playersWhoVoted, 0);
    assert.equal(result.totalVotes, 0);
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
