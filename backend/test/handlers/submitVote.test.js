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

const aliceSession = { token: 'test-token-alice', player_id: 'P001', device_id: 'dev-alice', email: 'alice@test.com' };

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
        voteData: { leader1Id: '1', opponentId: 'P002' },
        deviceId: 'dev-alice',
      },
      env,
      aliceSession
    );
    assert.equal(typeof result.raffleTickets, 'number');
    assert.ok(result.weeklyParticipation);
    assert.equal(typeof result.weeklyParticipation.voted, 'number');
    assert.equal(typeof result.weeklyParticipation.total, 'number');
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
            voteData: { leader1Id: '1', opponentId: 'P002' },
          },
          { DB: db },
          aliceSession
        ),
      (err) => {
        assert.equal(err.status, 403);
        return true;
      }
    );
  });

  it('duplicate vote (same season/week/player) → 409', async () => {
    const tables = submitVoteTables();
    tables.votes.push({
      id: 100,
      timestamp: new Date().toISOString(),
      updated_at: null,
      season_id: 6,
      week: 3,
      player_id: 'P001',
      leader_id: '1',
      opponent_id: 'P002',
    });
    const db = createMockDb(tables);
    await assert.rejects(
      () =>
        handleSubmitVote(
          {
            voteData: { leader1Id: '2', opponentId: 'P002' },
          },
          { DB: db },
          aliceSession
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
            voteData: { leader1Id: '1', opponentId: 'P001' },
          },
          env,
          aliceSession
        ),
      (err) => {
        assert.equal(err.status, 400);
        return true;
      }
    );
  });

  it('missing voteData → 400', async () => {
    await assert.rejects(
      () => handleSubmitVote({ token: 'test-token-alice' }, env, aliceSession),
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
            voteData: { opponentId: 'P002' },
          },
          env,
          aliceSession
        ),
      (err) => {
        assert.equal(err.status, 400);
        return true;
      }
    );
  });

  it('missing opponentId → 400', async () => {
    await assert.rejects(
      () =>
        handleSubmitVote(
          {
            voteData: { leader1Id: '1' },
          },
          env,
          aliceSession
        ),
      (err) => {
        assert.equal(err.status, 400);
        return true;
      }
    );
  });

  it('UNIQUE constraint violation caught → 409', async () => {
    const tables = submitVoteTables();
    const db = createMockDb(tables);
    const origPrepare = db.prepare.bind(db);
    db.prepare = function(sql) {
      const stmt = origPrepare(sql);
      if (sql.includes('INSERT INTO votes')) {
        const failRun = async function() {
          throw new Error('UNIQUE constraint failed');
        };
        stmt.run = failRun;
        const origBind = stmt.bind.bind(stmt);
        stmt.bind = function(...params) {
          const bound = origBind(...params);
          bound.run = failRun;
          return bound;
        };
      }
      return stmt;
    };
    await assert.rejects(
      () =>
        handleSubmitVote(
          {
            voteData: { leader1Id: '1', opponentId: 'P002' },
          },
          { DB: db },
          aliceSession
        ),
      (err) => {
        assert.equal(err.status, 409);
        return true;
      }
    );
  });

  it('no active season setting → 400', async () => {
    const tables = submitVoteTables();
    tables.settings = tables.settings.filter(s => s.key !== 'ACTIVE_SEASON_ID');
    const db = createMockDb(tables);
    await assert.rejects(
      () =>
        handleSubmitVote(
          {
            voteData: { leader1Id: '1', opponentId: 'P002' },
          },
          { DB: db },
          aliceSession
        ),
      (err) => {
        assert.equal(err.status, 400);
        return true;
      }
    );
  });

  it('vote row inserted with both leader and opponent', async () => {
    await handleSubmitVote(
      {
        voteData: { leader1Id: '1', opponentId: 'P002' },
        deviceId: 'dev-alice',
      },
      env,
      aliceSession
    );
    const store = DB.getStore();
    const votes = store.votes.filter(r => r.player_id === 'P001' && r.season_id === 6 && r.week === 3);
    assert.equal(votes.length, 1, 'vote row inserted');
    assert.equal(votes[0].leader_id, '1');
    assert.equal(votes[0].opponent_id, 'P002');
  });

  it('accepts leaderId as field alias', async () => {
    const result = await handleSubmitVote(
      {
        voteData: { leaderId: '1', opponentId: 'P002' },
      },
      env,
      aliceSession
    );
    assert.equal(typeof result.raffleTickets, 'number');
  });

  it('accepts favoriteOpponentId as field alias', async () => {
    const result = await handleSubmitVote(
      {
        voteData: { leader1Id: '1', favoriteOpponentId: 'P002' },
      },
      env,
      aliceSession
    );
    assert.equal(typeof result.raffleTickets, 'number');
  });

  it('self-voting check rejects when opponent is self', async () => {
    await assert.rejects(
      () =>
        handleSubmitVote(
          {
            voteData: { leader1Id: '1', opponentId: 'P001' },
          },
          env,
          aliceSession
        ),
      (err) => {
        assert.equal(err.status, 400);
        return true;
      }
    );
  });

  it('null session (bypassing router) → 401', async () => {
    await assert.rejects(
      () => handleSubmitVote({ voteData: { leader1Id: '1' } }, env, null),
      (err) => {
        assert.equal(err.status, 401);
        return true;
      }
    );
  });

  it('leader field alias works', async () => {
    const result = await handleSubmitVote(
      {
        voteData: { leader: '1', opponentId: 'P002' },
        deviceId: 'dev-alice',
      },
      env,
      aliceSession
    );
    assert.ok(result);
    assert.equal(typeof result.raffleTickets, 'number');
  });

  it('opponent field alias works', async () => {
    const result = await handleSubmitVote(
      {
        voteData: { leader1Id: '1', opponent: 'P002' },
        deviceId: 'dev-alice',
      },
      env,
      aliceSession
    );
    assert.ok(result);
    assert.equal(typeof result.raffleTickets, 'number');
  });
});
