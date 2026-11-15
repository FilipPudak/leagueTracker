import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeSeasonRewards } from '../../src/lib/seasonRewards.js';

const players = [
  { id: 'P1', name: 'Ada', active: 1 },
  { id: 'P2', name: 'Bo', active: 0 },
  { id: 'P3', name: 'Cy', active: 1 },
];

const votes = (playerId, weeks) => weeks.map(week => ({ player_id: playerId, week }));
const attended = (playerId, weeks) => weeks.map(week => ({ player_id: playerId, week }));

describe('computeSeasonRewards', () => {
  it('lists only players who voted', () => {
    const result = computeSeasonRewards({
      players,
      votes: votes('P1', [1]),
      attendance: [...attended('P1', [1]), ...attended('P3', [1, 2])],
    });
    assert.equal(result.playerCount, 1);
    assert.deepEqual(result.players.map(p => p.playerId), ['P1']);
  });

  it('counts one ticket per voted week and totals them', () => {
    const result = computeSeasonRewards({
      players,
      votes: [...votes('P1', [1, 2, 3]), ...votes('P2', [1])],
      attendance: [],
    });
    assert.equal(result.totalTickets, 4);
    assert.equal(result.players.find(p => p.playerId === 'P1').tickets, 3);
    assert.equal(result.players.find(p => p.playerId === 'P2').tickets, 1);
  });

  it('counts only votes in attended weeks for compliance but keeps every ticket', () => {
    const result = computeSeasonRewards({
      players,
      votes: votes('P1', [1, 2, 3, 4, 99]),
      attendance: attended('P1', [1, 2, 3, 4, 5]),
    });
    const row = result.players[0];
    assert.equal(row.tickets, 5, 'a grace vote in an unattended week is still a raffle ticket');
    assert.equal(row.attended, 5);
    assert.equal(row.votedInAttended, 4);
    assert.equal(row.compliancePct, 80);
    assert.equal(row.qualifies80, true);
    assert.equal(row.milestoneComplete, true);
  });

  it('requires the 4-vote floor even at a 100% ratio', () => {
    const result = computeSeasonRewards({
      players,
      votes: votes('P1', [1, 2, 3]),
      attendance: attended('P1', [1, 2, 3]),
    });
    const row = result.players[0];
    assert.equal(row.compliancePct, 100);
    assert.equal(row.qualifies80, false);
    assert.equal(row.milestoneComplete, false);
  });

  it('does not qualify below 80% even with 4+ votes', () => {
    const result = computeSeasonRewards({
      players,
      votes: votes('P1', [1, 2, 3, 4]),
      attendance: attended('P1', [1, 2, 3, 4, 5, 6]),
    });
    const row = result.players[0];
    assert.equal(row.compliancePct, 67);
    assert.equal(row.milestoneComplete, true);
    assert.equal(row.qualifies80, false);
  });

  it('qualifies with 8 of 9 attended weeks', () => {
    const result = computeSeasonRewards({
      players,
      votes: votes('P1', [1, 2, 3, 4, 5, 6, 7, 8]),
      attendance: attended('P1', [1, 2, 3, 4, 5, 6, 7, 8, 9]),
    });
    const row = result.players[0];
    assert.equal(row.compliancePct, 89);
    assert.equal(row.qualifies80, true);
  });

  it('handles a voter who never attended', () => {
    const result = computeSeasonRewards({
      players,
      votes: votes('P1', [1]),
      attendance: [],
    });
    const row = result.players[0];
    assert.equal(row.tickets, 1);
    assert.equal(row.attended, 0);
    assert.equal(row.compliancePct, null);
    assert.equal(row.qualifies80, false);
    assert.equal(row.bestStreak, 0);
  });

  it('a missed attendance does not break the streak', () => {
    const result = computeSeasonRewards({
      players,
      votes: votes('P1', [1, 2, 4]),
      attendance: attended('P1', [1, 2, 4, 5]),
    });
    assert.equal(result.players[0].bestStreak, 3, 'weeks 1, 2, 4 are consecutive attended weeks');
  });

  it('an unvoted attended week breaks the streak', () => {
    const result = computeSeasonRewards({
      players,
      votes: votes('P1', [1, 3]),
      attendance: attended('P1', [1, 2, 3]),
    });
    assert.equal(result.players[0].bestStreak, 1);
  });

  it('deduplicates repeated rows defensively', () => {
    const result = computeSeasonRewards({
      players,
      votes: votes('P1', [1, 1]),
      attendance: attended('P1', [1, 1]),
    });
    const row = result.players[0];
    assert.equal(row.tickets, 1);
    assert.equal(row.attended, 1);
    assert.equal(result.totalTickets, 1);
  });

  it('keeps inactive players who voted', () => {
    const result = computeSeasonRewards({
      players,
      votes: votes('P2', [1]),
      attendance: [],
    });
    assert.equal(result.players[0].active, false);
  });

  it('falls back to the player id when the player row is missing', () => {
    const result = computeSeasonRewards({
      players: [],
      votes: votes('P9', [1]),
      attendance: [],
    });
    assert.equal(result.players[0].name, 'P9');
    assert.equal(result.players[0].active, false);
  });

  it('sorts by tickets descending, then name ascending', () => {
    const result = computeSeasonRewards({
      players: [
        { id: 'P1', name: 'Zed', active: 1 },
        { id: 'P2', name: 'Amy', active: 1 },
        { id: 'P3', name: 'Bob', active: 1 },
      ],
      votes: [...votes('P1', [1, 2]), ...votes('P2', [1, 2]), ...votes('P3', [1])],
      attendance: [],
    });
    assert.deepEqual(result.players.map(p => p.name), ['Amy', 'Zed', 'Bob']);
  });

  it('returns zero totals for empty inputs', () => {
    const result = computeSeasonRewards({ players: [], votes: [], attendance: [] });
    assert.deepEqual(result, { playerCount: 0, totalTickets: 0, players: [] });
  });

  it('applies the open-week cutoff to the ratio but never to tickets', () => {
    const result = computeSeasonRewards({
      players,
      votes: votes('P1', [1, 2, 3, 4]),
      attendance: attended('P1', [1, 2, 3, 4]),
      cutoffWeek: 3,
    });
    const row = result.players[0];
    assert.equal(row.tickets, 4);
    assert.equal(row.attended, 3);
    assert.equal(row.votedInAttended, 3);
    assert.equal(row.compliancePct, 100);
  });

  it('handles unsorted input rows', () => {
    const result = computeSeasonRewards({
      players,
      votes: votes('P1', [2, 1]),
      attendance: attended('P1', [2, 1]),
    });
    const row = result.players[0];
    assert.equal(row.tickets, 2);
    assert.equal(row.compliancePct, 100);
    assert.equal(row.bestStreak, 2);
  });
});
