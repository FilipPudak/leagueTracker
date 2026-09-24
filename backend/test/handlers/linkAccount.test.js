import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMockDb } from '../helpers/mock-db.js';
import { basicTables } from '../helpers/fixtures.js';
import { installCryptoMock } from '../helpers/mock-crypto.js';
import { handleLinkAccount } from '../../src/handlers/linkAccount.js';

const now = new Date().toISOString();

function linkTables() {
  const t = basicTables();
  t.settings = t.settings.map(s =>
    s.key === 'ACTIVE_SEASON_ID' ? { ...s, value: '6' } : s
  );
  return t;
}

describe('handleLinkAccount', () => {
  let DB;
  let env;

  beforeEach(() => {
    installCryptoMock();
    const tables = linkTables();
    DB = createMockDb(tables);
    env = { DB };
  });

  it('fresh link creates session and returns token', async () => {
    const result = await handleLinkAccount(
      { playerId: 'P004', email: 'diana@test.com', deviceId: 'dev-diana' },
      env
    );
    assert.ok(result.token);
    assert.equal(typeof result.token, 'string');
    assert.equal(result.linkedPlayer.id, 'P004');
    assert.equal(result.linkedPlayer.email, 'diana@test.com');
  });

  it('relink same device reuses token', async () => {
    const result1 = await handleLinkAccount(
      { playerId: 'P001', email: 'alice@test.com', deviceId: 'dev-alice' },
      env
    );
    assert.equal(result1.token, 'test-token-alice');
  });

  it('missing playerId + unknown email → 404 with guidance', async () => {
    await assert.rejects(
      () => handleLinkAccount({ email: 'test@test.com', deviceId: 'dev' }, env),
      (err) => {
        assert.equal(err.status, 404);
        assert.match(err.message, /No linked account/);
        return true;
      }
    );
  });

  it('multi-device: email-only link resolves player by claimed email', async () => {
    const result = await handleLinkAccount(
      { email: 'alice@test.com', deviceId: 'dev-phone' },
      env
    );
    assert.ok(result.token);
    assert.equal(result.linkedPlayer.id, 'P001');
    assert.notEqual(result.token, 'test-token-alice', 'new device gets a new token');
    const store = DB.getStore();
    const sessions = store.sessions.filter(s => s.player_id === 'P001');
    assert.equal(sessions.length, 2, 'second session row for second device');
  });

  it('multi-device: email-only link on known device reuses token', async () => {
    const result = await handleLinkAccount(
      { email: 'alice@test.com', deviceId: 'dev-alice' },
      env
    );
    assert.equal(result.token, 'test-token-alice');
  });

  it('invalid email → 400', async () => {
    await assert.rejects(
      () => handleLinkAccount({ playerId: 'P001', email: 'not-an-email', deviceId: 'dev' }, env),
      (err) => {
        assert.equal(err.status, 400);
        return true;
      }
    );
  });

  it('missing email → 400', async () => {
    await assert.rejects(
      () => handleLinkAccount({ playerId: 'P001', deviceId: 'dev' }, env),
      (err) => {
        assert.equal(err.status, 400);
        return true;
      }
    );
  });

  it('player not found → 404', async () => {
    await assert.rejects(
      () =>
        handleLinkAccount(
          { playerId: 'P999', email: 'nobody@test.com', deviceId: 'dev' },
          env
        ),
      (err) => {
        assert.equal(err.status, 404);
        return true;
      }
    );
  });

  it('email already linked to different player → 409', async () => {
    await assert.rejects(
      () =>
        handleLinkAccount(
          { playerId: 'P002', email: 'alice@test.com', deviceId: 'dev' },
          env
        ),
      (err) => {
        assert.equal(err.status, 409);
        return true;
      }
    );
  });

  it('returns leaders, players, seasons, votingOpen', async () => {
    const result = await handleLinkAccount(
      { playerId: 'P001', email: 'alice@test.com', deviceId: 'dev-new' },
      env
    );
    assert.ok(Array.isArray(result.leaders));
    assert.ok(result.leaders.length >= 3);
    assert.ok(result.leaders[0].id);
    assert.ok(result.leaders[0].name);
    assert.ok(Array.isArray(result.players));
    assert.ok(result.players.length >= 4);
    assert.ok(Array.isArray(result.seasons));
    assert.ok(result.seasons.length >= 2);
    assert.equal(typeof result.votingOpen, 'boolean');
  });

  it('returns currentVote on relink when the player already voted this week', async () => {
    const tables = linkTables();
    tables.votes = [
      { id: 1, timestamp: '2026-06-15T18:00:00Z', updated_at: null, season_id: 6, week: 3, player_id: 'P001', leader_id: '2', opponent_id: 'P003' },
    ];
    env = { DB: createMockDb(tables) };

    const result = await handleLinkAccount(
      { playerId: 'P001', email: 'alice@test.com', deviceId: 'dev-relink' },
      env
    );
    assert.equal(result.alreadyVoted, true);
    assert.deepEqual(result.currentVote, { leaderId: '2', opponentId: 'P003' });
  });

  it('narrows opponent list to faced players when match data exists', async () => {
    const tables = linkTables();
    tables.match_results = [
      { season_id: 6, round: 3, melee_match_id: 'mm1', player1_id: 'P001', player2_id: 'P002', winner_id: 'P001', result: 'P001 won 2-0-0', is_bye: 0 },
      { season_id: 6, round: 3, melee_match_id: 'mm2', player1_id: 'P003', player2_id: 'P004', winner_id: 'P003', result: 'P003 won 2-1-0', is_bye: 0 },
    ];
    env = { DB: createMockDb(tables) };

    const result = await handleLinkAccount(
      { playerId: 'P001', email: 'alice@test.com', deviceId: 'dev-facelink' },
      env
    );
    assert.equal(result.facedOnly, true);
    assert.deepEqual(result.players.map(p => p.id), ['P002']);
    assert.ok(result.roster.length > result.players.length, 'roster keeps full list');
  });

  it('different device creates new session for same player', async () => {
    const result = await handleLinkAccount(
      { playerId: 'P001', email: 'alice@test.com', deviceId: 'dev-different' },
      env
    );
    assert.ok(result.token);
    assert.notEqual(result.token, 'test-token-alice', 'new token for different device');
  });

  it('relink with existing email but same email succeeds', async () => {
    const result = await handleLinkAccount(
      { playerId: 'P001', email: 'alice@test.com', deviceId: 'dev-alice' },
      env
    );
    assert.equal(result.token, 'test-token-alice', 'same token reused');
    assert.equal(result.linkedPlayer.email, 'alice@test.com');
  });

  it('relink with different email rejected when player already has email', async () => {
    await assert.rejects(
      () => handleLinkAccount(
        { playerId: 'P001', email: 'newemail@test.com', deviceId: 'dev-alice' },
        env
      ),
      (err) => {
        assert.equal(err.status, 403);
        assert.match(err.message, /already has an email/i);
        return true;
      }
    );
  });

  it('alreadyVoted true when player has votes', async () => {
    const tables = linkTables();
    tables.votes = [
      ...tables.votes,
      { id: 100, timestamp: now, updated_at: null, season_id: 6, week: 3, player_id: 'P001', leader_id: '2', opponent_id: 'P002' },
    ];
    DB = createMockDb(tables);
    env = { DB };
    const result = await handleLinkAccount(
      { playerId: 'P001', email: 'alice@test.com', deviceId: 'dev-alice' },
      env
    );
    assert.equal(result.alreadyVoted, true, 'P001 voted in week 3 already');
  });

  it('alreadyVoted false when player has not voted', async () => {
    const result = await handleLinkAccount(
      { playerId: 'P004', email: 'diana@test.com', deviceId: 'dev-diana' },
      env
    );
    assert.equal(result.alreadyVoted, false, 'P004 has not voted');
  });

  it('weeklyParticipation included in response', async () => {
    const result = await handleLinkAccount(
      { playerId: 'P001', email: 'alice@test.com', deviceId: 'dev-alice' },
      env
    );
    assert.ok(result.weeklyParticipation);
    assert.equal(typeof result.weeklyParticipation.voted, 'number');
    assert.equal(typeof result.weeklyParticipation.total, 'number');
  });

  describe('attended field (tri-state)', () => {
    it('returns null when week has no attendance data (grace)', async () => {
      const result = await handleLinkAccount(
        { playerId: 'P001', email: 'alice@test.com', deviceId: 'dev-alice' },
        env
      );
      assert.equal(result.attended, null, 'Week 3 has no rows in fixture → unknown, not false');
    });

    it('returns true when player attended current week', async () => {
      const tables = linkTables();
      tables.attendance.push({ season_id: 6, week: 3, player_id: 'P001' });
      DB = createMockDb(tables);
      env = { DB };
      const result = await handleLinkAccount(
        { playerId: 'P001', email: 'alice@test.com', deviceId: 'dev-alice' },
        env
      );
      assert.equal(result.attended, true);
    });

    it('returns false when week has data but player is missing', async () => {
      const tables = linkTables();
      tables.attendance.push({ season_id: 6, week: 3, player_id: 'P002' });
      DB = createMockDb(tables);
      env = { DB };
      const result = await handleLinkAccount(
        { playerId: 'P001', email: 'alice@test.com', deviceId: 'dev-alice' },
        env
      );
      assert.equal(result.attended, false);
    });
  });

  it('missing deviceId → 400', async () => {
    await assert.rejects(
      () => handleLinkAccount({ playerId: 'P001', email: 'alice@test.com' }, env),
      (err) => {
        assert.equal(err.status, 400);
        assert.match(err.message, /device/i);
        return true;
      }
    );
  });
});
