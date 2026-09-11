import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeDeckWinRates } from '../../src/lib/careerStats.js';
import { createMockDb } from '../helpers/mock-db.js';

function voteRow(playerId, leaderId, week, seasonId = 6) {
  return { season_id: seasonId, week, player_id: playerId, leader_id: leaderId, opponent_id: 'P002' };
}

function matchRow(p1, p2, winner, round, result, extra = {}) {
  return { season_id: 6, round, player1_id: p1, player2_id: p2, winner_id: winner, result, is_bye: 0, melee_match_id: `m${round}`, ...extra };
}

function leaderRow(id, name, setCode = 'SHD') {
  return { id, name, set: setCode };
}

describe('lib/careerStats computeDeckWinRates', () => {

  it('returns empty array when no votes or matches', async () => {
    const db = createMockDb({ votes: [], match_results: [], leaders: [] });
    const rates = await computeDeckWinRates(db, 'P001', 6);
    assert.deepEqual(rates, []);
  });

  it('computes win rate for a single leader', async () => {
    const db = createMockDb({
      votes: [voteRow('P001', 'L1', 1)],
      match_results: [matchRow('P001', 'P002', 'P001', 1, 'Alice won 2-0-0')],
      leaders: [leaderRow('L1', 'Darth Vader')],
    });
    const rates = await computeDeckWinRates(db, 'P001', 6);
    assert.equal(rates.length, 1);
    assert.equal(rates[0].leaderId, 'L1');
    assert.equal(rates[0].leaderName, 'Darth Vader');
    assert.equal(rates[0].wins, 1);
    assert.equal(rates[0].losses, 0);
    assert.equal(rates[0].draws, 0);
    assert.equal(rates[0].played, 1);
    assert.equal(rates[0].winPct, 100);
  });

  it('computes losses when player lost', async () => {
    const db = createMockDb({
      votes: [voteRow('P001', 'L1', 1)],
      match_results: [matchRow('P001', 'P002', 'P002', 1, 'Bob won 2-0-0')],
      leaders: [leaderRow('L1', 'Darth Vader')],
    });
    const rates = await computeDeckWinRates(db, 'P001', 6);
    assert.equal(rates[0].wins, 0);
    assert.equal(rates[0].losses, 1);
    assert.equal(rates[0].winPct, 0);
  });

  it('computes draws', async () => {
    const db = createMockDb({
      votes: [voteRow('P001', 'L1', 1)],
      match_results: [matchRow('P001', 'P002', null, 1, '1-1 Draw')],
      leaders: [leaderRow('L1', 'Darth Vader')],
    });
    const rates = await computeDeckWinRates(db, 'P001', 6);
    assert.equal(rates[0].wins, 0);
    assert.equal(rates[0].losses, 0);
    assert.equal(rates[0].draws, 1);
    assert.equal(rates[0].played, 1);
  });

  it('aggregates across multiple weeks for same leader', async () => {
    const db = createMockDb({
      votes: [
        voteRow('P001', 'L1', 1),
        voteRow('P001', 'L1', 2),
        voteRow('P001', 'L1', 3),
      ],
      match_results: [
        matchRow('P001', 'P002', 'P001', 1, 'Alice won 2-0-0'),
        matchRow('P001', 'P002', 'P001', 2, 'Alice won 2-1-0'),
        matchRow('P001', 'P002', 'P002', 3, 'Bob won 2-0-0'),
      ],
      leaders: [leaderRow('L1', 'Darth Vader')],
    });
    const rates = await computeDeckWinRates(db, 'P001', 6);
    assert.equal(rates.length, 1);
    assert.equal(rates[0].wins, 2);
    assert.equal(rates[0].losses, 1);
    assert.equal(rates[0].played, 3);
    assert.equal(rates[0].winPct, 66.7);
  });

  it('separates stats by leader', async () => {
    const db = createMockDb({
      votes: [
        voteRow('P001', 'L1', 1),
        voteRow('P001', 'L2', 2),
      ],
      match_results: [
        matchRow('P001', 'P002', 'P001', 1, 'Alice won 2-0-0'),
        matchRow('P001', 'P002', 'P002', 2, 'Bob won 2-0-0'),
      ],
      leaders: [leaderRow('L1', 'Darth Vader'), leaderRow('L2', 'Luke Skywalker')],
    });
    const rates = await computeDeckWinRates(db, 'P001', 6);
    assert.equal(rates.length, 2);
    const vader = rates.find(r => r.leaderId === 'L1');
    const luke = rates.find(r => r.leaderId === 'L2');
    assert.equal(vader.wins, 1);
    assert.equal(vader.losses, 0);
    assert.equal(luke.wins, 0);
    assert.equal(luke.losses, 1);
  });

  it('ignores bye matches', async () => {
    const db = createMockDb({
      votes: [voteRow('P001', 'L1', 1)],
      match_results: [
        { season_id: 6, round: 1, player1_id: 'P001', player2_id: null, winner_id: 'P001', result: null, is_bye: 1, melee_match_id: 'm1' },
      ],
      leaders: [leaderRow('L1', 'Darth Vader')],
    });
    const rates = await computeDeckWinRates(db, 'P001', 6);
    assert.equal(rates.length, 0);
  });

  it('only counts matches within the specified season', async () => {
    const db = createMockDb({
      votes: [
        voteRow('P001', 'L1', 1, 6),
        voteRow('P001', 'L1', 1, 5),
      ],
      match_results: [
        matchRow('P001', 'P002', 'P001', 1, 'Alice won 2-0-0', { season_id: 6 }),
        matchRow('P001', 'P002', 'P001', 1, 'Alice won 2-0-0', { season_id: 5 }),
      ],
      leaders: [leaderRow('L1', 'Darth Vader')],
    });
    const rates = await computeDeckWinRates(db, 'P001', 6);
    assert.equal(rates.length, 1);
    assert.equal(rates[0].played, 1);
  });

  it('sorts by games played descending', async () => {
    const db = createMockDb({
      votes: [
        voteRow('P001', 'L1', 1),
        voteRow('P001', 'L1', 2),
        voteRow('P001', 'L2', 3),
      ],
      match_results: [
        matchRow('P001', 'P002', 'P001', 1, 'Alice won 2-0-0'),
        matchRow('P001', 'P002', 'P001', 2, 'Alice won 2-0-0'),
        matchRow('P001', 'P002', 'P001', 3, 'Alice won 2-0-0'),
      ],
      leaders: [leaderRow('L1', 'Darth Vader'), leaderRow('L2', 'Luke Skywalker')],
    });
    const rates = await computeDeckWinRates(db, 'P001', 6);
    assert.equal(rates[0].leaderId, 'L1');
    assert.equal(rates[0].played, 2);
    assert.equal(rates[1].leaderId, 'L2');
    assert.equal(rates[1].played, 1);
  });

  it('handles votes without matching matches gracefully', async () => {
    const db = createMockDb({
      votes: [voteRow('P001', 'L1', 1)],
      match_results: [],
      leaders: [leaderRow('L1', 'Darth Vader')],
    });
    const rates = await computeDeckWinRates(db, 'P001', 6);
    assert.equal(rates.length, 0);
  });

  it('returns null winPct when no decisions (all draws)', async () => {
    const db = createMockDb({
      votes: [voteRow('P001', 'L1', 1)],
      match_results: [matchRow('P001', 'P002', null, 1, '1-1 Draw')],
      leaders: [leaderRow('L1', 'Darth Vader')],
    });
    const rates = await computeDeckWinRates(db, 'P001', 6);
    assert.equal(rates[0].winPct, null);
  });
});
