import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMockDb } from '../helpers/mock-db.js';
import { basicTables } from '../helpers/fixtures.js';
import { auditVotesForWeek } from '../../src/lib/voteAudit.js';

function weekOneSetup(votes, matches = [], attendance = null) {
  const tables = basicTables();
  tables.votes = votes;
  tables.match_results = matches;
  if (attendance) tables.attendance = attendance;
  return createMockDb(tables);
}

describe('lib/voteAudit', () => {
  it('clean week: attended voters who faced their pick → no violations', async () => {
    const db = weekOneSetup(
      [
        { season_id: 6, week: 1, player_id: 'P001', opponent_id: 'P002' },
        { season_id: 6, week: 1, player_id: 'P002', opponent_id: 'P001' },
      ],
      [
        { season_id: 6, round: 1, melee_match_id: 'm1', player1_id: 'P001', player2_id: 'P002', winner_id: 'P001', result: null, is_bye: 0 },
      ]
    );

    const audit = await auditVotesForWeek(db, 6, 1);
    assert.equal(audit.total, 2);
    assert.deepEqual(audit.nonAttendees, []);
    assert.deepEqual(audit.notFaced, []);
  });

  it('flags voters without an attendance row for the week', async () => {
    const db = weekOneSetup(
      [{ season_id: 6, week: 1, player_id: 'P004', opponent_id: 'P002' }],
      []
    );

    const audit = await auditVotesForWeek(db, 6, 1);
    assert.deepEqual(audit.nonAttendees, ['P004']);
    assert.deepEqual(audit.notFaced, []);
  });

  it('flags attended voters whose pick was not faced; does not expose the pair', async () => {
    const db = weekOneSetup(
      [{ season_id: 6, week: 1, player_id: 'P001', opponent_id: 'P003' }],
      [
        { season_id: 6, round: 1, melee_match_id: 'm1', player1_id: 'P001', player2_id: 'P002', winner_id: 'P001', result: null, is_bye: 0 },
      ]
    );

    const audit = await auditVotesForWeek(db, 6, 1);
    assert.deepEqual(audit.nonAttendees, []);
    assert.deepEqual(audit.notFaced, ['P001']);
    assert.ok(!JSON.stringify(audit).includes('P003'), 'violation output must not carry the nominee');
  });

  it('no match rows for the voter → no faced restriction (sync-gap grace)', async () => {
    const db = weekOneSetup(
      [{ season_id: 6, week: 1, player_id: 'P001', opponent_id: 'P003' }],
      [
        { season_id: 6, round: 1, melee_match_id: 'm1', player1_id: 'P002', player2_id: 'P003', winner_id: 'P002', result: null, is_bye: 0 },
      ]
    );

    const audit = await auditVotesForWeek(db, 6, 1);
    assert.deepEqual(audit.notFaced, []);
  });

  it('byes never create faced violations', async () => {
    const db = weekOneSetup(
      [{ season_id: 6, week: 1, player_id: 'P001', opponent_id: 'P003' }],
      [
        { season_id: 6, round: 1, melee_match_id: 'm1', player1_id: 'P001', player2_id: 'P002', winner_id: null, result: null, is_bye: 1 },
      ]
    );

    const audit = await auditVotesForWeek(db, 6, 1);
    assert.deepEqual(audit.notFaced, []);
  });

  it('week with no votes returns zero total', async () => {
    const db = weekOneSetup([]);
    const audit = await auditVotesForWeek(db, 6, 1);
    assert.equal(audit.total, 0);
  });
});
