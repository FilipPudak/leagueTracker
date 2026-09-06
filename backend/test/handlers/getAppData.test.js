import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMockDb } from '../helpers/mock-db.js';
import { basicTables } from '../helpers/fixtures.js';
import { handleGetAppData } from '../../src/handlers/getAppData.js';

describe('handleGetAppData', () => {
  let DB;
  let env;

  beforeEach(() => {
    const tables = basicTables();
    DB = createMockDb(tables);
    env = { DB };
  });

  it('returns linked player info when session provided', async () => {
    const session = { token: 'test-token-alice', player_id: 'P001', device_id: 'dev-alice', email: 'alice@test.com' };
    const result = await handleGetAppData({}, env, session);
    assert.equal(result.status, 'linked');
    assert.equal(result.linkedPlayer.id, 'P001');
    assert.equal(result.linkedPlayer.name, 'Alice');
    assert.equal(result.linkedPlayer.email, 'alice@test.com');
  });

  it('returns status unlinked when no session', async () => {
    const result = await handleGetAppData({}, env, null);
    assert.equal(result.status, 'unlinked');
    assert.equal(result.linkedPlayer, null);
  });

  it('returns status invalid-token for null session', async () => {
    const result = await handleGetAppData({ token: 'unknown-token' }, env, null);
    assert.equal(result.status, 'invalid-token');
    assert.equal(result.linkedPlayer, null);
  });

  it('includes seasons, players, leaders', async () => {
    const result = await handleGetAppData({}, env, null);
    assert.ok(Array.isArray(result.seasons));
    assert.ok(result.seasons.length >= 2);
    assert.ok(Array.isArray(result.players));
    assert.ok(result.players.length >= 4);
    assert.ok(Array.isArray(result.leaders));
    assert.ok(result.leaders.length >= 3);
    assert.ok(result.players[0].id);
    assert.ok(result.players[0].name);
    assert.ok(result.leaders[0].id);
    assert.ok(result.leaders[0].name);
    assert.ok(result.leaders[0].set);
  });

  it('includes weeklyParticipation', async () => {
    const result = await handleGetAppData({}, env, null);
    assert.ok(result.weeklyParticipation);
    assert.equal(typeof result.weeklyParticipation.voted, 'number');
    assert.equal(typeof result.weeklyParticipation.total, 'number');
  });

  it('returns votingOpen from settings', async () => {
    const result = await handleGetAppData({}, env, null);
    assert.equal(result.votingOpen, true);
  });

  it('returns false votingOpen when settings say FALSE', async () => {
    const tables = basicTables();
    tables.settings = tables.settings.map(s =>
      s.key === 'VOTING_OPEN' ? { ...s, value: 'FALSE' } : s
    );
    const db = createMockDb(tables);
    const result = await handleGetAppData({}, { DB: db }, null);
    assert.equal(result.votingOpen, false);
  });

  it('detects alreadySubmitted when player voted this week', async () => {
    const tables = basicTables();
    tables.leader_votes.push({
      timestamp: new Date().toISOString(),
      season_id: 6,
      week: 3,
      player_id: 'P001',
      leader_id: '2',
    });
    const db = createMockDb(tables);
    const session = { token: 'test-token-alice', player_id: 'P001', device_id: 'dev-alice', email: 'alice@test.com' };
    const result = await handleGetAppData({}, { DB: db }, session);
    assert.equal(result.alreadySubmitted, true);
  });

  it('alreadySubmitted is false when player has not voted', async () => {
    const session = { token: 'test-token-bob', player_id: 'P002', device_id: 'dev-bob', email: 'bob@test.com' };
    const result = await handleGetAppData({}, env, session);
    assert.equal(result.alreadySubmitted, false);
  });

  it('returns currentPlayer alias for linkedPlayer', async () => {
    const session = { token: 'test-token-alice', player_id: 'P001', device_id: 'dev-alice', email: 'alice@test.com' };
    const result = await handleGetAppData({}, env, session);
    assert.deepEqual(result.currentPlayer, result.linkedPlayer);
  });

  it('returns alreadyVoted alias for alreadySubmitted', async () => {
    const session = { token: 'test-token-alice', player_id: 'P001', device_id: 'dev-alice', email: 'alice@test.com' };
    const result = await handleGetAppData({}, env, session);
    assert.equal(result.alreadyVoted, result.alreadySubmitted);
  });

  it('returns unlinkedPlayers when user is unlinked', async () => {
    const result = await handleGetAppData({}, env, null);
    assert.ok(Array.isArray(result.unlinkedPlayers));
    assert.ok(result.unlinkedPlayers.length > 0);
    assert.ok(result.unlinkedPlayers[0].id);
    assert.ok(result.unlinkedPlayers[0].name);
  });

  it('returns empty unlinkedPlayers when user is linked', async () => {
    const session = { token: 'test-token-alice', player_id: 'P001', device_id: 'dev-alice', email: 'alice@test.com' };
    const result = await handleGetAppData({}, env, session);
    assert.deepEqual(result.unlinkedPlayers, []);
  });
});
