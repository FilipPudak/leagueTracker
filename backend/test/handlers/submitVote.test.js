import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMockDb } from '../helpers/mock-db.js';
import { basicTables, closedVotingTables } from '../helpers/fixtures.js';
import { installCryptoMock } from '../helpers/mock-crypto.js';
import { handleSubmitVote } from '../../src/handlers/submitVote.js';

function submitVoteTables() {
  const t = basicTables();
  t.settings = t.settings.map(s =>
    s.key === 'ACTIVE_SEASON_ID' ? { ...s, value: '6' } : s
  );
  return t;
}

describe('handleSubmitVote', () => {
  let DB;
  let env;

  beforeEach(() => {
    installCryptoMock();
    const tables = submitVoteTables();
    DB = createMockDb(tables);
    env = { DB };
  });

  it('successful vote returns raffleTickets and weeklyParticipation', async () => {
    const result = await handleSubmitVote(
      {
        token: 'test-token-alice',
        voteData: { leader1Id: '1', opponentId: 'P002' },
        deviceId: 'dev-alice',
      },
      env
    );
    assert.equal(typeof result.raffleTickets, 'number');
    assert.ok(result.weeklyParticipation);
    assert.equal(typeof result.weeklyParticipation.voted, 'number');
    assert.equal(typeof result.weeklyParticipation.total, 'number');
  });

  it('missing token → 401', async () => {
    await assert.rejects(
      () => handleSubmitVote({ voteData: { leader1Id: '1', opponentId: 'P002' } }, env),
      (err) => {
        assert.equal(err.status, 401);
        return true;
      }
    );
  });

  it('invalid session token → 401', async () => {
    await assert.rejects(
      () =>
        handleSubmitVote(
          {
            token: 'bogus-token',
            voteData: { leader1Id: '1', opponentId: 'P002' },
          },
          env
        ),
      (err) => {
        assert.equal(err.status, 401);
        return true;
      }
    );
  });

  it('voting closed → 403', async () => {
    const tables = closedVotingTables();
    tables.settings = tables.settings.map(s =>
      s.key === 'ACTIVE_SEASON_ID' ? { ...s, value: '6' } : s
    );
    const db = createMockDb(tables);
    await assert.rejects(
      () =>
        handleSubmitVote(
          {
            token: 'test-token-alice',
            voteData: { leader1Id: '1', opponentId: 'P002' },
          },
          { DB: db }
        ),
      (err) => {
        assert.equal(err.status, 403);
        return true;
      }
    );
  });

  it('duplicate vote (same season/week/player) → 409', async () => {
    const tables = submitVoteTables();
    tables.leader_votes.push({
      timestamp: new Date().toISOString(),
      season_id: 6,
      week: 3,
      player_id: 'P001',
      leader_id: '1',
    });
    const db = createMockDb(tables);
    await assert.rejects(
      () =>
        handleSubmitVote(
          {
            token: 'test-token-alice',
            voteData: { leader1Id: '2', opponentId: 'P002' },
          },
          { DB: db }
        ),
      (err) => {
        assert.equal(err.status, 409);
        return true;
      }
    );
  });

  it('self-voting (opponentId === playerId) → 400', async () => {
    await assert.rejects(
      () =>
        handleSubmitVote(
          {
            token: 'test-token-alice',
            voteData: { leader1Id: '1', opponentId: 'P001' },
          },
          env
        ),
      (err) => {
        assert.equal(err.status, 400);
        return true;
      }
    );
  });

  it('missing voteData → 400', async () => {
    await assert.rejects(
      () => handleSubmitVote({ token: 'test-token-alice' }, env),
      (err) => {
        assert.equal(err.status, 400);
        return true;
      }
    );
  });

  it('missing leader1Id → 400', async () => {
    await assert.rejects(
      () =>
        handleSubmitVote(
          {
            token: 'test-token-alice',
            voteData: { opponentId: 'P002' },
          },
          env
        ),
      (err) => {
        assert.equal(err.status, 400);
        return true;
      }
    );
  });
});
