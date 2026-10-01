import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMockDb } from '../helpers/mock-db.js';
import { basicTables } from '../helpers/fixtures.js';
import { handleGetVoteBootstrap } from '../../src/handlers/getVoteBootstrap.js';

function tablesWithWeek3() {
  const tables = basicTables();
  tables.votes = [
    ...tables.votes,
    { id: 4, timestamp: new Date().toISOString(), updated_at: null, season_id: 6, week: 3, player_id: 'P001', leader_id: '1', opponent_id: 'P002' },
  ];
  tables.attendance = [
    ...tables.attendance,
    { season_id: 6, week: 3, player_id: 'P001' },
    { season_id: 6, week: 3, player_id: 'P002' },
    { season_id: 6, week: 3, player_id: 'P003' },
  ];
  tables.melee_tournaments = [
    ...tables.melee_tournaments,
    { season_id: 6, round: 3, melee_id: 'm3', name: 'Week 3', phase: 'regular' },
  ];
  return tables;
}

describe('handleGetVoteBootstrap', () => {
  let DB;
  let env;

  beforeEach(() => {
    const tables = tablesWithWeek3();
    DB = createMockDb(tables);
    env = { DB };
  });

  it('returns weeklyParticipation with voted and total', async () => {
    const result = await handleGetVoteBootstrap({}, env);
    assert.ok(result.weeklyParticipation);
    assert.equal(typeof result.weeklyParticipation.voted, 'number');
    assert.equal(typeof result.weeklyParticipation.total, 'number');
  });

  it('returns correct voted count for current week', async () => {
    const result = await handleGetVoteBootstrap({}, env);
    assert.equal(result.weeklyParticipation.voted, 1);
  });

  it('returns correct total attendance for current week', async () => {
    const result = await handleGetVoteBootstrap({}, env);
    assert.equal(result.weeklyParticipation.total, 3);
  });

  it('returns null weeklyParticipation when no active season', async () => {
    const tables = tablesWithWeek3();
    tables.settings = tables.settings.filter(s => s.key !== 'ACTIVE_SEASON_ID');
    const db = createMockDb(tables);
    const result = await handleGetVoteBootstrap({}, { DB: db });
    assert.equal(result.weeklyParticipation, null);
  });

  it('returns null weeklyParticipation when no current week', async () => {
    const tables = tablesWithWeek3();
    tables.settings = tables.settings.filter(s => s.key !== 'CURRENT_WEEK');
    const db = createMockDb(tables);
    const result = await handleGetVoteBootstrap({}, { DB: db });
    assert.equal(result.weeklyParticipation, null);
  });

  it('returns 0 voted and 0 total for week with no data', async () => {
    const tables = tablesWithWeek3();
    tables.settings = tables.settings.map(s =>
      s.key === 'CURRENT_WEEK' ? { ...s, value: 'Week 99' } : s
    );
    const db = createMockDb(tables);
    const result = await handleGetVoteBootstrap({}, { DB: db });
    assert.ok(result.weeklyParticipation);
    assert.equal(result.weeklyParticipation.voted, 0);
    assert.equal(result.weeklyParticipation.total, 0);
  });

  it('does not require a session parameter', async () => {
    const result = await handleGetVoteBootstrap({}, env, null);
    assert.ok(result.weeklyParticipation);
  });

  describe('session-aware fields', () => {
    const session = { token: 'test-token-alice', player_id: 'P001', device_id: 'dev-alice', email: 'alice@test.com' };

    it('returns attended true when session player has attendance for current week', async () => {
      const result = await handleGetVoteBootstrap({}, env, session);
      assert.equal(result.attended, true);
    });

    it('returns attended false when session player has no attendance for current week', async () => {
      const tables = tablesWithWeek3();
      tables.attendance = tables.attendance.filter(a => !(a.week === 3 && a.player_id === 'P001'));
      const db = createMockDb(tables);
      const result = await handleGetVoteBootstrap({}, { DB: db }, session);
      assert.equal(result.attended, false);
    });

    it('returns attended null and unfiltered players list when no session', async () => {
      const result = await handleGetVoteBootstrap({}, env, null);
      assert.equal(result.attended, null);
      assert.equal(result.players, null);
    });

    it('filters players to faced opponents when voting open and match data exists', async () => {
      const tables = tablesWithWeek3();
      tables.match_results = [
        { season_id: 6, round: 3, melee_match_id: 'mm1', player1_id: 'P001', player2_id: 'P002', winner_id: 'P001', result: '2-0', is_bye: 0 },
      ];
      const db = createMockDb(tables);
      const result = await handleGetVoteBootstrap({}, { DB: db }, session);
      assert.equal(result.facedOnly, true);
      const ids = result.players.map(p => p.id);
      assert.ok(ids.includes('P002'), 'faced opponent included');
      assert.ok(!ids.includes('P003'), 'unfaced player excluded');
    });

    it('returns unfiltered players when voting is closed', async () => {
      const tables = tablesWithWeek3();
      tables.settings = tables.settings.map(s =>
        s.key === 'VOTING_OPEN' ? { ...s, value: 'FALSE' } : s
      );
      tables.match_results = [
        { season_id: 6, round: 3, melee_match_id: 'mm1', player1_id: 'P001', player2_id: 'P002', winner_id: 'P001', result: '2-0', is_bye: 0 },
      ];
      const db = createMockDb(tables);
      const result = await handleGetVoteBootstrap({}, { DB: db }, session);
      assert.equal(result.facedOnly, false);
      assert.ok(result.players.length > 1);
      assert.equal(result.attended, true, 'attended still resolved when voting closed');
    });

    it('returns all players when session exists but no match data', async () => {
      const result = await handleGetVoteBootstrap({}, env, session);
      assert.equal(result.facedOnly, false);
      assert.equal(result.players.length, 5);
    });

    it('echoes the current week number', async () => {
      const result = await handleGetVoteBootstrap({}, env, session);
      assert.equal(result.week, 3);
    });

    it('returns alreadyVoted true and currentVote for a player who voted', async () => {
      const result = await handleGetVoteBootstrap({}, env, session);
      assert.equal(result.alreadyVoted, true);
      assert.deepEqual(result.currentVote, { leaderId: '1', opponentId: 'P002' });
    });

    it('returns alreadyVoted false and null currentVote for a player who has not voted', async () => {
      const noVoteSession = { token: 'test-token-bob', player_id: 'P002', device_id: 'dev-bob', email: 'bob@test.com' };
      const result = await handleGetVoteBootstrap({}, env, noVoteSession);
      assert.equal(result.alreadyVoted, false);
      assert.equal(result.currentVote, null);
    });

    it('returns null alreadyVoted and null currentVote when no session', async () => {
      const result = await handleGetVoteBootstrap({}, env, null);
      assert.equal(result.alreadyVoted, null);
      assert.equal(result.currentVote, null);
    });

    it('returns null alreadyVoted and null week when no active season', async () => {
      const tables = tablesWithWeek3();
      tables.settings = tables.settings.filter(s => s.key !== 'ACTIVE_SEASON_ID');
      const db = createMockDb(tables);
      const result = await handleGetVoteBootstrap({}, { DB: db }, session);
      assert.equal(result.attended, null);
      assert.equal(result.week, null);
      assert.equal(result.weeklyParticipation, null);
      assert.equal(result.alreadyVoted, null);
      assert.equal(result.currentVote, null);
    });
  });
});
