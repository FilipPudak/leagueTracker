import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMockDb } from '../helpers/mock-db.js';
import { emptyTables } from '../helpers/fixtures.js';
import {
  getStreaks,
  getRaffleTickets,
  getWeeklyParticipation,
  getSeasonParticipation,
  getAttendedStatus,
  getVotingCompliance,
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

describe('getAttendedStatus', () => {
  it('returns true when player has an attendance row in a week that has data', async () => {
    const db = createMockDb(makeStreakTables());
    assert.equal(await getAttendedStatus(db, 7, 1, 'P100'), true);
  });

  it('returns false when week has attendance rows but not the player', async () => {
    const db = createMockDb(makeStreakTables());
    assert.equal(await getAttendedStatus(db, 7, 1, 'P103'), false);
  });

  it('returns null when the week has no attendance data at all (grace rule)', async () => {
    const db = createMockDb(makeStreakTables());
    assert.equal(await getAttendedStatus(db, 7, 9, 'P100'), null,
      'unknown must not masquerade as false — mirrors validateVote grace');
  });

  it('returns null with empty tables', async () => {
    const db = createMockDb(emptyTables());
    assert.equal(await getAttendedStatus(db, 6, 1, 'P001'), null);
  });
});

function makeComplianceTables() {
  const now = new Date().toISOString();
  const vote = (id, week, player_id) => (
    { id, timestamp: now, updated_at: null, season_id: 7, week, player_id, leader_id: '1', opponent_id: 'P200' }
  );
  const attend = (week, player_id) => ({ season_id: 7, week, player_id });
  return {
    settings: [],
    players: [
      { id: 'P200', name: 'OnTrack', melee_name: 'ontrack', email: 'ontrack@test.com', active: 1 },
      { id: 'P201', name: 'Almost', melee_name: 'almost', email: 'almost@test.com', active: 1 },
      { id: 'P202', name: 'PerfectButThree', melee_name: 'pb3', email: 'pb3@test.com', active: 1 },
      { id: 'P203', name: 'EightOfNine', melee_name: '8of9', email: '8of9@test.com', active: 1 },
      { id: 'P204', name: 'GraceVoter', melee_name: 'grace', email: 'grace@test.com', active: 1 },
      { id: 'P205', name: 'NoShow', melee_name: 'noshow', email: 'noshow@test.com', active: 1 },
      { id: 'P206', name: 'CutOnly', melee_name: 'cutonly', email: 'cutonly@test.com', active: 1 },
    ],
    leaders: [],
    seasons: [],
    sessions: [],
    votes: [
      vote(1, 1, 'P200'), vote(2, 2, 'P200'), vote(3, 3, 'P200'), vote(4, 4, 'P200'),
      vote(5, 1, 'P201'), vote(6, 2, 'P201'), vote(7, 3, 'P201'),
      vote(8, 1, 'P202'), vote(9, 2, 'P202'), vote(10, 3, 'P202'),
      vote(11, 1, 'P203'), vote(12, 2, 'P203'), vote(13, 3, 'P203'), vote(14, 4, 'P203'),
      vote(15, 6, 'P203'), vote(16, 7, 'P203'), vote(17, 8, 'P203'), vote(18, 9, 'P203'),
      vote(19, 1, 'P204'), vote(20, 2, 'P204'), vote(21, 3, 'P204'), vote(22, 4, 'P204'),
      vote(23, 99, 'P204'),
      vote(24, 1, 'P205'),
      vote(25, 10, 'P206'),
    ],
    awards: [],
    attendance: [
      attend(1, 'P200'), attend(2, 'P200'), attend(3, 'P200'), attend(4, 'P200'), attend(5, 'P200'),
      attend(1, 'P201'), attend(2, 'P201'), attend(3, 'P201'), attend(4, 'P201'), attend(5, 'P201'),
      attend(1, 'P202'), attend(2, 'P202'), attend(3, 'P202'),
      attend(1, 'P203'), attend(2, 'P203'), attend(3, 'P203'), attend(4, 'P203'), attend(5, 'P203'),
      attend(6, 'P203'), attend(7, 'P203'), attend(8, 'P203'), attend(9, 'P203'),
      attend(1, 'P204'), attend(2, 'P204'), attend(3, 'P204'), attend(4, 'P204'), attend(5, 'P204'),
      attend(10, 'P206'),
    ],
    melee_tournaments: [
      ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(r => ({ season_id: 7, round: r, phase: 'regular' })),
      { season_id: 7, round: 10, phase: 'cut' },
    ],
  };
}

describe('getVotingCompliance', () => {
  it('returns attended, voted, pct, qualifying and target keys', async () => {
    const db = createMockDb(makeComplianceTables());
    const result = await getVotingCompliance(db, 7, 'P200');
    assert.deepEqual(Object.keys(result).sort(), ['attended', 'pct', 'qualifying', 'target', 'voted']);
  });

  it('qualifies at exactly 80% with 4 votes', async () => {
    const db = createMockDb(makeComplianceTables());
    const result = await getVotingCompliance(db, 7, 'P200');
    assert.deepEqual(result, { attended: 5, voted: 4, pct: 80, qualifying: true, target: 80 });
  });

  it('does not qualify below 80%', async () => {
    const db = createMockDb(makeComplianceTables());
    const result = await getVotingCompliance(db, 7, 'P201');
    assert.deepEqual(result, { attended: 5, voted: 3, pct: 60, qualifying: false, target: 80 });
  });

  it('perfect ratio but under 4 votes does not qualify (vote floor)', async () => {
    const db = createMockDb(makeComplianceTables());
    const result = await getVotingCompliance(db, 7, 'P202');
    assert.deepEqual(result, { attended: 3, voted: 3, pct: 100, qualifying: false, target: 80 });
  });

  it('qualifies with 8 of 9 attended weeks', async () => {
    const db = createMockDb(makeComplianceTables());
    const result = await getVotingCompliance(db, 7, 'P203');
    assert.deepEqual(result, { attended: 9, voted: 8, pct: 89, qualifying: true, target: 80 });
  });

  it('grace vote in an unattended week is excluded from the numerator', async () => {
    const db = createMockDb(makeComplianceTables());
    const result = await getVotingCompliance(db, 7, 'P204');
    assert.deepEqual(result, { attended: 5, voted: 4, pct: 80, qualifying: true, target: 80 },
      'week 99 vote must not count — numerator is the attended/voted intersection');
  });

  it('voted but never attended → pct null, not qualifying', async () => {
    const db = createMockDb(makeComplianceTables());
    const result = await getVotingCompliance(db, 7, 'P205');
    assert.deepEqual(result, { attended: 0, voted: 0, pct: null, qualifying: false, target: 80 });
  });

  it('cut-phase attendance is ignored', async () => {
    const db = createMockDb(makeComplianceTables());
    const result = await getVotingCompliance(db, 7, 'P206');
    assert.deepEqual(result, { attended: 0, voted: 0, pct: null, qualifying: false, target: 80 });
  });

  it('cutoff excludes the current week and beyond, for attendance and votes', async () => {
    const db = createMockDb(makeComplianceTables());
    const result = await getVotingCompliance(db, 7, 'P200', 3);
    assert.deepEqual(result, { attended: 2, voted: 2, pct: 100, qualifying: false, target: 80 },
      'weeks >= 3 (still-open window) must not count on either side');
  });

  it('cutoff beyond the last week counts everything, like a null cutoff', async () => {
    const db1 = createMockDb(makeComplianceTables());
    const db2 = createMockDb(makeComplianceTables());
    const withNull = await getVotingCompliance(db1, 7, 'P200');
    const withLarge = await getVotingCompliance(db2, 7, 'P200', 99);
    assert.deepEqual(withNull, { attended: 5, voted: 4, pct: 80, qualifying: true, target: 80 });
    assert.deepEqual(withLarge, withNull);
  });

  it('returns zeroed result with empty tables', async () => {
    const db = createMockDb(emptyTables());
    const result = await getVotingCompliance(db, 6, 'P001');
    assert.deepEqual(result, { attended: 0, voted: 0, pct: null, qualifying: false, target: 80 });
  });

  it('returns zeroed result for unknown player', async () => {
    const db = createMockDb(makeComplianceTables());
    const result = await getVotingCompliance(db, 7, 'P999');
    assert.deepEqual(result, { attended: 0, voted: 0, pct: null, qualifying: false, target: 80 });
  });
});
