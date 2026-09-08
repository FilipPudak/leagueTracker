import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMockDb } from '../helpers/mock-db.js';
import { basicTables } from '../helpers/fixtures.js';
import { handleUpdateVote } from '../../src/handlers/updateVote.js';

function makeTables(overrides = {}) {
  const t = basicTables();
  if (overrides.settings) t.settings = overrides.settings;
  if (overrides.votes) t.votes = overrides.votes;
  return t;
}

function makeSession(playerId = 'P001') {
  return { player_id: playerId, token: 'test-token', device_id: 'dev1' };
}

describe('handleUpdateVote', () => {
  let db;

  it('updates existing vote with new leader and opponent', async () => {
    const tables = makeTables({
      settings: [
        { key: 'ACTIVE_SEASON_ID', value: '6' },
        { key: 'CURRENT_WEEK', value: 'Week 2' },
        { key: 'VOTING_OPEN', value: 'TRUE' },
      ],
      votes: [
        { id: 1, timestamp: '2026-01-01T00:00:00Z', season_id: 6, week: 2, player_id: 'P001', leader_id: 'L001', opponent_id: 'P002' },
      ],
    });
    db = createMockDb(tables);

    const result = await handleUpdateVote(
      { voteData: { leader1Id: 'L002', opponentId: 'P003' } },
      { DB: db },
      makeSession()
    );

    const store = db.getStore();
    const vote = store.votes.find(v => v.player_id === 'P001' && v.week === 2);
    assert.equal(vote.leader_id, 'L002');
    assert.equal(vote.opponent_id, 'P003');
    assert.ok(vote.updated_at, 'updated_at is set');
  });

  it('returns 401 when session is null', async () => {
    const tables = makeTables();
    db = createMockDb(tables);

    await assert.rejects(
      () => handleUpdateVote({ voteData: {} }, { DB: db }, null),
      (err) => { assert.equal(err.status, 401); return true; }
    );
  });

  it('returns 403 when voting is closed', async () => {
    const tables = makeTables({
      settings: [
        { key: 'ACTIVE_SEASON_ID', value: '6' },
        { key: 'CURRENT_WEEK', value: 'Week 2' },
        { key: 'VOTING_OPEN', value: 'FALSE' },
      ],
    });
    db = createMockDb(tables);

    await assert.rejects(
      () => handleUpdateVote({ voteData: { leader1Id: 'L001', opponentId: 'P002' } }, { DB: db }, makeSession()),
      (err) => { assert.equal(err.status, 403); return true; }
    );
  });

  it('returns 404 when no existing vote', async () => {
    const tables = makeTables({
      settings: [
        { key: 'ACTIVE_SEASON_ID', value: '6' },
        { key: 'CURRENT_WEEK', value: 'Week 2' },
        { key: 'VOTING_OPEN', value: 'TRUE' },
      ],
      votes: [],
    });
    db = createMockDb(tables);

    await assert.rejects(
      () => handleUpdateVote({ voteData: { leader1Id: 'L001', opponentId: 'P002' } }, { DB: db }, makeSession()),
      (err) => { assert.equal(err.status, 404); return true; }
    );
  });

  it('returns 400 when leader is missing', async () => {
    const tables = makeTables({
      settings: [
        { key: 'ACTIVE_SEASON_ID', value: '6' },
        { key: 'CURRENT_WEEK', value: 'Week 2' },
        { key: 'VOTING_OPEN', value: 'TRUE' },
      ],
      votes: [
        { id: 1, timestamp: '2026-01-01T00:00:00Z', season_id: 6, week: 2, player_id: 'P001', leader_id: 'L001', opponent_id: 'P002' },
      ],
    });
    db = createMockDb(tables);

    await assert.rejects(
      () => handleUpdateVote({ voteData: { opponentId: 'P002' } }, { DB: db }, makeSession()),
      (err) => { assert.equal(err.status, 400); return true; }
    );
  });

  it('returns 400 when opponent is missing', async () => {
    const tables = makeTables({
      settings: [
        { key: 'ACTIVE_SEASON_ID', value: '6' },
        { key: 'CURRENT_WEEK', value: 'Week 2' },
        { key: 'VOTING_OPEN', value: 'TRUE' },
      ],
      votes: [
        { id: 1, timestamp: '2026-01-01T00:00:00Z', season_id: 6, week: 2, player_id: 'P001', leader_id: 'L001', opponent_id: 'P002' },
      ],
    });
    db = createMockDb(tables);

    await assert.rejects(
      () => handleUpdateVote({ voteData: { leader1Id: 'L001' } }, { DB: db }, makeSession()),
      (err) => { assert.equal(err.status, 400); return true; }
    );
  });

  it('returns 400 when self-voting', async () => {
    const tables = makeTables({
      settings: [
        { key: 'ACTIVE_SEASON_ID', value: '6' },
        { key: 'CURRENT_WEEK', value: 'Week 2' },
        { key: 'VOTING_OPEN', value: 'TRUE' },
      ],
      votes: [
        { id: 1, timestamp: '2026-01-01T00:00:00Z', season_id: 6, week: 2, player_id: 'P001', leader_id: 'L001', opponent_id: 'P002' },
      ],
    });
    db = createMockDb(tables);

    await assert.rejects(
      () => handleUpdateVote({ voteData: { leader1Id: 'L001', opponentId: 'P001' } }, { DB: db }, makeSession()),
      (err) => { assert.equal(err.status, 400); return true; }
    );
  });
});
