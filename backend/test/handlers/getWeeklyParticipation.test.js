import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMockDb } from '../helpers/mock-db.js';
import { basicTables } from '../helpers/fixtures.js';
import { handleGetWeeklyParticipation } from '../../src/handlers/getWeeklyParticipation.js';

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

describe('handleGetWeeklyParticipation', () => {
  let DB;
  let env;

  beforeEach(() => {
    const tables = tablesWithWeek3();
    DB = createMockDb(tables);
    env = { DB };
  });

  it('returns weeklyParticipation with voted and total', async () => {
    const result = await handleGetWeeklyParticipation({}, env);
    assert.ok(result.weeklyParticipation);
    assert.equal(typeof result.weeklyParticipation.voted, 'number');
    assert.equal(typeof result.weeklyParticipation.total, 'number');
  });

  it('returns correct voted count for current week', async () => {
    const result = await handleGetWeeklyParticipation({}, env);
    assert.equal(result.weeklyParticipation.voted, 1);
  });

  it('returns correct total attendance for current week', async () => {
    const result = await handleGetWeeklyParticipation({}, env);
    assert.equal(result.weeklyParticipation.total, 3);
  });

  it('returns null weeklyParticipation when no active season', async () => {
    const tables = tablesWithWeek3();
    tables.settings = tables.settings.filter(s => s.key !== 'ACTIVE_SEASON_ID');
    const db = createMockDb(tables);
    const result = await handleGetWeeklyParticipation({}, { DB: db });
    assert.equal(result.weeklyParticipation, null);
  });

  it('returns null weeklyParticipation when no current week', async () => {
    const tables = tablesWithWeek3();
    tables.settings = tables.settings.filter(s => s.key !== 'CURRENT_WEEK');
    const db = createMockDb(tables);
    const result = await handleGetWeeklyParticipation({}, { DB: db });
    assert.equal(result.weeklyParticipation, null);
  });

  it('returns 0 voted and 0 total for week with no data', async () => {
    const tables = tablesWithWeek3();
    tables.settings = tables.settings.map(s =>
      s.key === 'CURRENT_WEEK' ? { ...s, value: 'Week 99' } : s
    );
    const db = createMockDb(tables);
    const result = await handleGetWeeklyParticipation({}, { DB: db });
    assert.ok(result.weeklyParticipation);
    assert.equal(result.weeklyParticipation.voted, 0);
    assert.equal(result.weeklyParticipation.total, 0);
  });

  it('does not require a session parameter', async () => {
    const result = await handleGetWeeklyParticipation({}, env, null);
    assert.ok(result.weeklyParticipation);
  });
});
