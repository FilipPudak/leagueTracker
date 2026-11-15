import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMockDb } from '../helpers/mock-db.js';
import { basicTables } from '../helpers/fixtures.js';
import { handleGetSeasonRewards } from '../../src/handlers/getSeasonRewards.js';

const ADMIN_SECRET = 'test-admin-secret';

function rewardTables() {
  return basicTables();
}

function call(tables, body = {}) {
  const db = createMockDb(tables);
  return handleGetSeasonRewards({ adminToken: ADMIN_SECRET, ...body }, { DB: db, ADMIN_SECRET });
}

describe('handleGetSeasonRewards', () => {
  it('rejects a missing admin token', async () => {
    await assert.rejects(
      () => handleGetSeasonRewards({ seasonId: 6 }, { DB: createMockDb(rewardTables()), ADMIN_SECRET }),
      (err) => { assert.equal(err.status, 403); return true; }
    );
  });

  it('rejects a wrong admin token', async () => {
    await assert.rejects(
      () => handleGetSeasonRewards({ adminToken: 'nope', seasonId: 6 }, { DB: createMockDb(rewardTables()), ADMIN_SECRET }),
      (err) => { assert.equal(err.status, 403); return true; }
    );
  });

  it('rejects a missing seasonId with 400', async () => {
    await assert.rejects(
      () => call(rewardTables()),
      (err) => { assert.equal(err.status, 400); assert.match(err.message, /seasonId/); return true; }
    );
  });

  it('rejects an unparseable seasonId with 400', async () => {
    await assert.rejects(
      () => call(rewardTables(), { seasonId: 'banana' }),
      (err) => { assert.equal(err.status, 400); return true; }
    );
  });

  it('rejects an unknown season with 400', async () => {
    await assert.rejects(
      () => call(rewardTables(), { seasonId: 99 }),
      (err) => { assert.equal(err.status, 400); assert.match(err.message, /Unknown season/); return true; }
    );
  });

  it('accepts a prefixed seasonId and reports the season name', async () => {
    const result = await call(rewardTables(), { seasonId: 'S6' });
    assert.equal(result.seasonId, 6);
    assert.equal(result.seasonName, 'Season 6');
  });

  it('returns one row per voter with tickets and totals', async () => {
    const result = await call(rewardTables(), { seasonId: 6 });
    assert.equal(result.playerCount, 2);
    assert.equal(result.totalTickets, 3);
    const alice = result.players.find(p => p.playerId === 'P001');
    assert.equal(alice.name, 'Alice');
    assert.equal(alice.tickets, 2);
    assert.equal(alice.attended, 2);
    assert.equal(alice.votedInAttended, 2);
    assert.equal(alice.compliancePct, 100);
    assert.equal(alice.qualifies80, false);
    assert.equal(alice.milestoneComplete, false);
    assert.equal(alice.bestStreak, 2);
    const bob = result.players.find(p => p.playerId === 'P002');
    assert.equal(bob.tickets, 1);
    assert.equal(bob.attended, 2);
    assert.equal(bob.compliancePct, 50);
    assert.equal(bob.bestStreak, 1);
  });

  it('excludes players who attended but never voted', async () => {
    const result = await call(rewardTables(), { seasonId: 6 });
    assert.equal(result.players.some(p => p.playerId === 'P003'), false);
  });

  it('scopes strictly to the requested season', async () => {
    const tables = rewardTables();
    tables.votes.push({
      id: 50, timestamp: new Date().toISOString(), updated_at: null,
      season_id: 5, week: 1, player_id: 'P004', leader_id: '1', opponent_id: 'P001',
    });
    const s5 = await call(tables, { seasonId: 5 });
    assert.deepEqual(s5.players.map(p => p.playerId), ['P004']);
    const s6 = await call(rewardTables(), { seasonId: 6 });
    assert.equal(s6.players.some(p => p.playerId === 'P004'), false);
  });

  it('excludes cut-phase attendance from the season metrics', async () => {
    const tables = rewardTables();
    tables.melee_tournaments.push({ season_id: 6, round: 3, melee_id: 'm3', name: 'Cut', phase: 'cut' });
    tables.attendance.push({ season_id: 6, week: 3, player_id: 'P001' });
    tables.votes.push({
      id: 51, timestamp: new Date().toISOString(), updated_at: null,
      season_id: 6, week: 3, player_id: 'P001', leader_id: '1', opponent_id: 'P002',
    });
    const result = await call(tables, { seasonId: 6 });
    const alice = result.players.find(p => p.playerId === 'P001');
    assert.equal(alice.tickets, 3);
    assert.equal(alice.attended, 2, 'cut attendance must not enter the regular-season ratio');
    assert.equal(alice.votedInAttended, 2);
    assert.equal(alice.compliancePct, 100);
  });

  it('keeps inactive voters in the list', async () => {
    const tables = rewardTables();
    tables.players = tables.players.map(p => p.id === 'P002' ? { ...p, active: 0 } : p);
    const result = await call(tables, { seasonId: 6 });
    assert.equal(result.players.find(p => p.playerId === 'P002').active, false);
  });

  it('flags a past season as ended', async () => {
    const result = await call(rewardTables(), { seasonId: 5 });
    assert.equal(result.isActiveSeason, false);
    assert.equal(result.seasonEnded, true);
  });

  it('flags the active season as provisional while voting is open', async () => {
    const result = await call(rewardTables(), { seasonId: 6 });
    assert.equal(result.isActiveSeason, true);
    assert.equal(result.seasonEnded, false);
  });

  it('flags the active season as ended after close', async () => {
    const tables = rewardTables();
    tables.settings = tables.settings.map(s =>
      s.key === 'CURRENT_WEEK' ? { ...s, value: 'Season Ended' } : s
    );
    const result = await call(tables, { seasonId: 6 });
    assert.equal(result.isActiveSeason, true);
    assert.equal(result.seasonEnded, true);
  });

  it('never emits opponent data', async () => {
    const result = await call(rewardTables(), { seasonId: 6 });
    assert.equal(JSON.stringify(result).includes('opponent'), false);
    assert.deepEqual(
      Object.keys(result.players[0]).sort(),
      ['active', 'attended', 'bestStreak', 'compliancePct', 'milestoneComplete', 'name', 'playerId', 'qualifies80', 'tickets', 'votedInAttended']
    );
  });

  it('returns an empty list for a pre-voting season', async () => {
    const tables = rewardTables();
    tables.votes = [];
    const result = await call(tables, { seasonId: 6 });
    assert.equal(result.playerCount, 0);
    assert.equal(result.totalTickets, 0);
    assert.deepEqual(result.players, []);
  });

  it('applies the CURRENT_WEEK cutoff to the active-season ratio', async () => {
    const tables = rewardTables();
    tables.melee_tournaments.push({ season_id: 6, round: 4, melee_id: 'm4', name: 'Week 4', phase: 'regular' });
    tables.attendance.push({ season_id: 6, week: 4, player_id: 'P001' });
    const result = await call(tables, { seasonId: 6 });
    const alice = result.players.find(p => p.playerId === 'P001');
    assert.equal(alice.attended, 2, 'week 4 is beyond CURRENT_WEEK=3 and must not enter the live ratio');
    assert.equal(alice.compliancePct, 100);
  });

  it('never claims a final state when settings are missing', async () => {
    const tables = rewardTables();
    tables.settings = [];
    const result = await call(tables, { seasonId: 6 });
    assert.equal(result.isActiveSeason, false);
    assert.equal(result.seasonEnded, false);
  });

  it('ignores attendance rows without a tournament row', async () => {
    const tables = rewardTables();
    tables.attendance.push({ season_id: 6, week: 9, player_id: 'P001' });
    const result = await call(tables, { seasonId: 6 });
    assert.equal(result.players.find(p => p.playerId === 'P001').attended, 2);
  });
});
