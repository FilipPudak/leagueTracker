import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMockDb } from '../helpers/mock-db.js';
import { basicTables } from '../helpers/fixtures.js';
import { handleRequestRename } from '../../src/handlers/requestRename.js';
import { handleListRenameRequests } from '../../src/handlers/listRenameRequests.js';
import { handleApproveRename } from '../../src/handlers/approveRename.js';
import { handleRejectRename } from '../../src/handlers/rejectRename.js';
import { handleMergePlayers } from '../../src/handlers/mergePlayers.js';
import { handleGetAppData } from '../../src/handlers/getAppData.js';
import { buildMergePlan } from '../../src/lib/playerMerge.js';
import { syncSeasonData } from '../../src/lib/leagueSync.js';
import { createPlayerFinder } from '../../src/lib/meleeLeague.js';
import { historyStatements } from '../../src/lib/usernames.js';

const ADMIN = 'test-admin-secret';
const SESSION = { player_id: 'P001', device_id: 'dev-alice' };

function env(db, extra = {}) {
  return { DB: db, ADMIN_SECRET: ADMIN, ...extra };
}

function seedHistory(tables, rows) {
  tables.player_usernames = rows;
  return tables;
}

function mergeTables() {
  const t = basicTables();
  t.players.push(
    { id: 'P053', name: 'Takras_Ola', melee_name: 'Takras_Ola', melee_guid: null, email: 'ola@test.com', active: 1 },
    { id: 'P086', name: 'Ola_la', melee_name: 'Ola_la', melee_guid: null, email: null, active: 1 },
  );
  t.player_usernames = [
    { player_id: 'P053', melee_name: 'Takras_Ola', name_lower: 'takras_ola', source: 'seed', first_seen: null, last_seen: '2026-01-01T00:00:00.000Z' },
    { player_id: 'P086', melee_name: 'Ola_la', name_lower: 'ola_la', source: 'sync', first_seen: '2026-11-05T00:00:00.000Z', last_seen: '2026-11-05T00:00:00.000Z' },
  ];
  t.season_standings = [
    { season_id: 6, round: 10, player_id: 'P086', wins: 2, losses: 1, draws: 0, match_points: 6, rank: 3 },
  ];
  t.match_results = [
    { id: 11, season_id: 6, round: 10, melee_match_id: 'm-a', player1_id: 'P086', player2_id: 'P004', winner_id: 'P086', result: '2-0', is_bye: 0 },
    { id: 12, season_id: 6, round: 10, melee_match_id: 'm-b', player1_id: 'P002', player2_id: 'P086', winner_id: 'P002', result: '2-1', is_bye: 0 },
  ];
  t.attendance = [
    { season_id: 6, week: 10, player_id: 'P086' },
    { season_id: 6, week: 10, player_id: 'P053' },
  ];
  t.votes = [
    { id: 101, timestamp: 'x', updated_at: null, season_id: 6, week: 9, player_id: 'P086', leader_id: '1', opponent_id: 'P004' },
    { id: 102, timestamp: 'x', updated_at: null, season_id: 6, week: 10, player_id: 'P002', leader_id: '2', opponent_id: 'P086' },
    { id: 103, timestamp: 'x', updated_at: null, season_id: 6, week: 8, player_id: 'P053', leader_id: '3', opponent_id: 'P086' },
  ];
  t.awards = [
    { season_id: 6, award_name: 'Galactic Ambassador', player_id: 'P086', score: 1 },
  ];
  t.sessions = [
    ...t.sessions,
    { token: 'orphan-token', player_id: 'P086', device_id: 'dev-orphan', email: '', created: '2026-11-01', last_active: new Date().toISOString() },
  ];
  t.rename_requests = [
    { id: 1, player_id: 'P053', old_melee_name: 'Takras_Ola', new_melee_name: 'ola_la', status: 'pending', melee_hint: 'found', requested_at: '2026-11-10T10:00:00.000Z', resolved_at: null, resolved_by: null, note: null },
  ];
  return t;
}

describe('handleRequestRename', () => {
  it('requires a session', async () => {
    const db = createMockDb(basicTables());
    await assert.rejects(
      () => handleRequestRename({ newMeleeName: 'alice_two' }, env(db), null),
      (err) => err.status === 401
    );
  });

  it('stores a pending request for the signed-in player', async () => {
    const db = createMockDb(seedHistory(basicTables(), []));
    const result = await handleRequestRename({ newMeleeName: 'alice_two' }, env(db), SESSION);

    assert.equal(result.status, 'pending');
    assert.equal(result.oldMeleeName, 'alice42');
    assert.equal(result.newMeleeName, 'alice_two');
    assert.equal(result.meleeHint, null, 'no Melee credentials ⇒ no hint, not a failure');
    const row = db.getStore().rename_requests[0];
    assert.equal(row.player_id, 'P001');
    assert.equal(row.status, 'pending');
    assert.ok(row.requested_at);
  });

  it('rejects a case-only same-name request', async () => {
    const db = createMockDb(seedHistory(basicTables(), []));
    await assert.rejects(
      () => handleRequestRename({ newMeleeName: 'ALICE42' }, env(db), SESSION),
      (err) => err.status === 400
    );
  });

  it('rejects a username held by another player with an email', async () => {
    const db = createMockDb(seedHistory(basicTables(), []));
    await assert.rejects(
      () => handleRequestRename({ newMeleeName: 'bob55' }, env(db), SESSION),
      (err) => err.status === 400 && /another player/.test(err.message)
    );
  });

  it('allows a username held only by an email-less auto-created row (merge case)', async () => {
    const db = createMockDb(seedHistory(basicTables(), []));
    const result = await handleRequestRename({ newMeleeName: 'diana77' }, env(db), SESSION);
    assert.equal(result.status, 'pending');
  });

  it('rejects malformed handles', async () => {
    const db = createMockDb(seedHistory(basicTables(), []));
    await assert.rejects(
      () => handleRequestRename({ newMeleeName: 'ab' }, env(db), SESSION),
      (err) => err.status === 400
    );
    await assert.rejects(
      () => handleRequestRename({ newMeleeName: 'bad name!' }, env(db), SESSION),
      (err) => err.status === 400
    );
  });

  it('overwrites the pending request instead of locking the member out', async () => {
    const tables = seedHistory(basicTables(), []);
    tables.rename_requests = [
      { id: 5, player_id: 'P001', old_melee_name: 'alice42', new_melee_name: 'alice_two', status: 'pending', melee_hint: 'found', requested_at: '2026-11-01T00:00:00.000Z', resolved_at: null, resolved_by: null, note: null },
    ];
    const db = createMockDb(tables);
    const result = await handleRequestRename({ newMeleeName: 'alice_three' }, env(db), SESSION);

    assert.equal(result.status, 'pending');
    assert.equal(result.updated, true);
    assert.equal(result.id, 5, 'the same row is reused, not duplicated');
    const rows = db.getStore().rename_requests;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].new_melee_name, 'alice_three');
    assert.notEqual(rows[0].requested_at, '2026-11-01T00:00:00.000Z', 'timestamp refreshed for the admin queue');
  });
});

describe('handleRequestRename – Discord notification', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('posts one message when the webhook secret is configured', async () => {
    const calls = [];
    globalThis.fetch = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 204 }; };
    const db = createMockDb(seedHistory(basicTables(), []));
    await handleRequestRename(
      { newMeleeName: 'alice_two' },
      env(db, { DISCORD_WEBHOOK_URL: 'https://discord.example/hook' }),
      SESSION
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://discord.example/hook');
    const body = JSON.parse(calls[0].init.body);
    assert.match(body.content, /alice42 → alice_two \(P001\)/);
  });

  it('labels an overwrite as an update instead of a new request', async () => {
    const calls = [];
    globalThis.fetch = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 204 }; };
    const tables = seedHistory(basicTables(), []);
    tables.rename_requests = [
      { id: 5, player_id: 'P001', old_melee_name: 'alice42', new_melee_name: 'alice_two', status: 'pending', melee_hint: 'found', requested_at: '2026-11-01T00:00:00.000Z', resolved_at: null, resolved_by: null, note: null },
    ];
    const db = createMockDb(tables);
    await handleRequestRename(
      { newMeleeName: 'alice_three' },
      env(db, { DISCORD_WEBHOOK_URL: 'https://discord.example/hook' }),
      SESSION
    );
    assert.equal(calls.length, 1);
    const body = JSON.parse(calls[0].init.body);
    assert.match(body.content, /^Rename request updated: alice42 → alice_three \(P001\)$/);
  });

  it('skips silently without a webhook secret', async () => {
    let called = 0;
    globalThis.fetch = async () => { called++; return { ok: true, status: 204 }; };
    const db = createMockDb(seedHistory(basicTables(), []));
    await handleRequestRename({ newMeleeName: 'alice_two' }, env(db), SESSION);
    assert.equal(called, 0);
  });

  it('still stores the request when the webhook throws', async () => {
    globalThis.fetch = async () => { throw new Error('discord down'); };
    const db = createMockDb(seedHistory(basicTables(), []));
    const result = await handleRequestRename(
      { newMeleeName: 'alice_two' },
      env(db, { DISCORD_WEBHOOK_URL: 'https://discord.example/hook' }),
      SESSION
    );
    assert.equal(result.status, 'pending');
    assert.equal(db.getStore().rename_requests.length, 1);
  });

  it('never treats a rejected webhook post as delivered', async () => {
    const warns = [];
    const originalWarn = console.warn;
    console.warn = (msg) => warns.push(String(msg));
    try {
      globalThis.fetch = async () => ({
        ok: false,
        status: 404,
        text: async () => '{"message": "Unknown Webhook", "code": 10015}',
      });
      const db = createMockDb(seedHistory(basicTables(), []));
      const result = await handleRequestRename(
        { newMeleeName: 'alice_two' },
        env(db, { DISCORD_WEBHOOK_URL: 'https://discord.example/hook' }),
        SESSION
      );
      assert.equal(result.status, 'pending', 'a dead webhook must not fail the member request');
      assert.equal(db.getStore().rename_requests.length, 1);
      assert.ok(warns.some((msg) => msg.includes('404') && msg.includes('Unknown Webhook')), 'the rejection must be logged');
    } finally {
      console.warn = originalWarn;
    }
  });

  it('trims whitespace around the stored webhook secret', async () => {
    const calls = [];
    globalThis.fetch = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 204 }; };
    const db = createMockDb(seedHistory(basicTables(), []));
    await handleRequestRename(
      { newMeleeName: 'alice_two' },
      env(db, { DISCORD_WEBHOOK_URL: 'https://discord.example/hook\n' }),
      SESSION
    );
    assert.equal(calls[0].url, 'https://discord.example/hook', 'a pasted trailing newline must not break the post');
  });
});

describe('handleListRenameRequests', () => {
  it('rejects a missing admin token', async () => {
    const db = createMockDb(basicTables());
    await assert.rejects(
      () => handleListRenameRequests({}, env(db)),
      (err) => err.status === 403
    );
  });

  it('returns the queue with the Melee hint', async () => {
    const tables = seedHistory(basicTables(), []);
    tables.rename_requests = [
      { id: 1, player_id: 'P001', old_melee_name: 'alice42', new_melee_name: 'alice_two', status: 'pending', melee_hint: 'found', requested_at: '2026-11-10T10:00:00.000Z', resolved_at: null, resolved_by: null, note: null },
    ];
    const db = createMockDb(tables);
    const result = await handleListRenameRequests({ adminToken: ADMIN }, env(db));
    assert.equal(result.requests.length, 1);
    assert.equal(result.requests[0].meleeHint, 'found');
    assert.equal(result.requests[0].newMeleeName, 'alice_two');
  });

  it('previews the rows approval would absorb, so the admin sees the risk first', async () => {
    const db = createMockDb(mergeTables());
    const result = await handleListRenameRequests({ adminToken: ADMIN }, env(db));
    const request = result.requests[0];
    assert.equal(request.conflictPlayerId, null);
    assert.deepEqual(request.mergeTargets.map((t) => t.playerId), ['P086']);
    assert.ok(request.mergeTargets[0].rows >= 4, 'counts the stored rows at stake');
  });

  it('counts a career that exists only on the opponent side of a vote', async () => {
    const tables = mergeTables();
    tables.season_standings = [];
    tables.attendance = [];
    tables.awards = [];
    tables.match_results = [];
    tables.votes = [
      { id: 201, timestamp: 'x', updated_at: null, season_id: 6, week: 6, player_id: 'P002', leader_id: '1', opponent_id: 'P086' },
    ];
    const db = createMockDb(tables);

    const result = await handleListRenameRequests({ adminToken: ADMIN }, env(db));
    const target = result.requests[0].mergeTargets[0];

    assert.equal(target.playerId, 'P086');
    assert.equal(target.rows, 1, 'opponent-side participation is still a career worth confirming');
  });

  it('flags an email-bearing holder as a conflict instead of a merge target', async () => {
    const tables = mergeTables();
    tables.players = tables.players.map(p => p.id === 'P086' ? { ...p, email: 'other@test.com' } : p);
    const db = createMockDb(tables);
    const result = await handleListRenameRequests({ adminToken: ADMIN }, env(db));
    assert.equal(result.requests[0].conflictPlayerId, 'P086');
    assert.deepEqual(result.requests[0].mergeTargets, []);
  });
});

describe('username history rows', () => {
  it('stores one row per handle regardless of casing', async () => {
    const db = createMockDb(seedHistory(basicTables(), []));
    await db.batch(historyStatements(db, { playerId: 'P001', meleeName: 'Alice_Old', source: 'admin' }));
    await db.batch(historyStatements(db, { playerId: 'P001', meleeName: 'alice_old', source: 'sync' }));
    const rows = db.getStore().player_usernames.filter(r => r.player_id === 'P001');
    assert.equal(rows.length, 1, 'a case variant must not become a second history row');
    assert.equal(rows[0].melee_name, 'alice_old', 'the freshest casing wins');
  });
});

describe('handleApproveRename', () => {
  it('rejects a missing admin token', async () => {
    const db = createMockDb(mergeTables());
    await assert.rejects(
      () => handleApproveRename({ playerId: 'P001', newMeleeName: 'alice_two' }, env(db)),
      (err) => err.status === 403
    );
  });

  it('updates the player, keeps the old name in history, and resolves the request', async () => {
    const tables = seedHistory(basicTables(), []);
    tables.rename_requests = [
      { id: 1, player_id: 'P001', old_melee_name: 'alice42', new_melee_name: 'alice_two', status: 'pending', melee_hint: 'found', requested_at: '2026-11-10T10:00:00.000Z', resolved_at: null, resolved_by: null, note: null },
    ];
    const db = createMockDb(tables);
    const result = await handleApproveRename({ requestId: 1, adminToken: ADMIN }, env(db));

    assert.equal(result.status, 'approved');
    const player = db.getStore().players.find(p => p.id === 'P001');
    assert.equal(player.melee_name, 'alice_two');
    assert.equal(player.name, 'Alice', 'display name is owned by the Melee sync, not by the rename');
    const history = db.getStore().player_usernames.find(r => r.melee_name === 'alice42');
    assert.equal(history.source, 'admin');
    assert.equal(db.getStore().rename_requests[0].status, 'approved');
    assert.ok(db.getStore().rename_requests[0].resolved_at);
  });

  it('requires an explicit confirmMerge before absorbing a holder with stored results', async () => {
    const db = createMockDb(mergeTables());
    await assert.rejects(
      () => handleApproveRename({ requestId: 1, adminToken: ADMIN }, env(db)),
      (err) => err.status === 400 && /confirmMerge/.test(err.message)
    );
    assert.equal(db.getStore().rename_requests[0].status, 'pending', 'a refused approval releases the claim');
    assert.equal(db.getStore().players.find(p => p.id === 'P053').melee_name, 'Takras_Ola');
  });

  it('absorbs an email-less orphan holding the new name, re-pointing every FK', async () => {
    const db = createMockDb(mergeTables());
    const result = await handleApproveRename({ requestId: 1, adminToken: ADMIN, confirmMerge: true }, env(db));
    const store = db.getStore();

    assert.deepEqual(result.merged, ['P086']);
    assert.equal(store.players.find(p => p.id === 'P053').melee_name, 'ola_la');
    assert.ok(!store.players.some(p => p.id === 'P086'), 'orphan row deleted');

    assert.equal(store.season_standings.length, 1);
    assert.equal(store.season_standings[0].player_id, 'P053');

    assert.deepEqual(store.match_results.map(m => [m.player1_id, m.player2_id, m.winner_id]), [
      ['P053', 'P004', 'P053'],
      ['P002', 'P053', 'P002'],
    ]);

    const votePlayerSide = store.votes.find(v => v.id === 101);
    assert.equal(votePlayerSide.player_id, 'P053');
    const voteOpponentSide = store.votes.find(v => v.id === 102);
    assert.equal(voteOpponentSide.opponent_id, 'P053');
    assert.ok(!store.votes.some(v => v.id === 103), 'a vote that would become a self-vote is dropped');

    assert.equal(store.awards.find(a => a.season_id === 6 && a.award_name === 'Galactic Ambassador').player_id, 'P053');
    assert.ok(!store.sessions.some(s => s.player_id === 'P086'), 'orphan sessions removed');
    assert.equal(store.player_usernames.filter(r => r.player_id === 'P086').length, 0);
    assert.ok(store.player_usernames.some(r => r.player_id === 'P053' && r.melee_name === 'Ola_la' && r.source === 'merge'));
    assert.match(store.rename_requests[0].note, /merged:/);
    assert.match(store.rename_requests[0].note, /dropped 2 duplicate row/);
  });

  it('never leaves a self-vote behind, even when both sides are the survivor', async () => {
    const db = createMockDb(mergeTables());
    await handleApproveRename({ requestId: 1, adminToken: ADMIN, confirmMerge: true }, env(db));
    const selfVotes = db.getStore().votes.filter(v => v.player_id === v.opponent_id);
    assert.deepEqual(selfVotes, []);
  });

  it('absorbs every email-less holder, not just the first', async () => {
    const tables = mergeTables();
    tables.players.push({ id: 'P091', name: 'Ola_la', melee_name: 'ola_la', melee_guid: null, email: null, active: 1 });
    tables.season_standings.push({ season_id: 6, round: 9, player_id: 'P091', wins: 1, losses: 2, draws: 0, match_points: 3, rank: 5 });
    const db = createMockDb(tables);

    const result = await handleApproveRename({ requestId: 1, adminToken: ADMIN, confirmMerge: true }, env(db));
    const store = db.getStore();

    assert.deepEqual(result.merged.sort(), ['P086', 'P091']);
    assert.ok(!store.players.some(p => p.id === 'P091'), 'second orphan deleted');
    assert.deepEqual(store.season_standings.map(r => r.player_id), ['P053', 'P053']);
  });

  it('plans a row shared by two orphans once, so nothing points at a deleted id', async () => {
    const tables = mergeTables();
    tables.players.push({ id: 'P091', name: 'Ola_la', melee_name: 'ola_la', melee_guid: null, email: null, active: 1 });
    tables.votes.push({ id: 104, timestamp: 'x', updated_at: null, season_id: 6, week: 7, player_id: 'P086', leader_id: '1', opponent_id: 'P091' });
    tables.match_results.push({ id: 13, season_id: 6, round: 9, melee_match_id: 'm-c', player1_id: 'P086', player2_id: 'P091', winner_id: 'P091', result: '1-2', is_bye: 0 });
    const db = createMockDb(tables);

    const result = await handleApproveRename({ requestId: 1, adminToken: ADMIN, confirmMerge: true }, env(db));
    const store = db.getStore();

    assert.ok(!store.votes.some(v => v.id === 104), 'cross-orphan vote becomes a self-vote, dropped once');
    assert.ok(!store.match_results.some(m => m.id === 13), 'cross-orphan match dropped once');
    assert.match(result.note, /dropped 4 duplicate row/, 'each dropped row is counted exactly once');

    const orphans = new Set(['P086', 'P091']);
    for (const vote of store.votes) {
      assert.ok(!orphans.has(vote.player_id) && !orphans.has(vote.opponent_id), `vote ${vote.id} references a deleted row`);
    }
    for (const match of store.match_results) {
      assert.ok(
        !orphans.has(match.player1_id) && !orphans.has(match.player2_id) && !orphans.has(match.winner_id),
        `match ${match.id} references a deleted row`
      );
    }
  });

  it('releases the orphan email before the survivor claims it (UNIQUE-safe order)', async () => {
    const tables = mergeTables();
    tables.players = tables.players.map((p) => {
      if (p.id === 'P053') return { ...p, email: null };
      if (p.id === 'P086') return { ...p, email: 'ola@test.com' };
      return p;
    });
    const db = createMockDb(tables);

    await handleMergePlayers({ survivorId: 'P053', orphanId: 'P086', adminToken: ADMIN }, env(db));

    assert.equal(db.getStore().players.find(p => p.id === 'P053').email, 'ola@test.com', 'survivor inherits the address');
    const emailWrites = db.getCalls()
      .filter(c => /UPDATE\s+players\s+SET\s+email/i.test(c.sql))
      .map(c => c.params);
    assert.deepEqual(
      emailWrites,
      [[null, 'P086'], ['ola@test.com', 'P053']],
      'the orphan must lose the address before the survivor takes it'
    );
  });

  it('re-points one session per device and drops the duplicate device', async () => {
    const tables = mergeTables();
    tables.sessions.push(
      { token: 'survivor-token', player_id: 'P053', device_id: 'dev-alice', email: '', created: '2026-11-01', last_active: '2026-11-01' },
      { token: 'orphan-token-2', player_id: 'P086', device_id: 'dev-alice', email: '', created: '2026-11-02', last_active: '2026-11-02' },
    );
    const db = createMockDb(tables);

    await handleApproveRename({ requestId: 1, adminToken: ADMIN, confirmMerge: true }, env(db));
    const sessions = db.getStore().sessions;

    assert.ok(sessions.some(s => s.token === 'orphan-token' && s.player_id === 'P053'), 'free device follows the survivor');
    assert.ok(!sessions.some(s => s.token === 'orphan-token-2'), 'device the survivor already holds is not duplicated');
    assert.ok(!sessions.some(s => s.player_id === 'P086'), 'no session is left on the deleted row');
  });

  it('keeps the better podium rank when both rows hold the same award', async () => {
    const tables = mergeTables();
    tables.awards = [
      { season_id: 6, award_name: 'Galactic Ambassador', player_id: 'P053', score: 2, rank: 2 },
      { season_id: 6, award_name: 'Galactic Ambassador', player_id: 'P086', score: 5, rank: 1 },
    ];
    const db = createMockDb(tables);

    await handleApproveRename({ requestId: 1, adminToken: ADMIN, confirmMerge: true }, env(db));
    const award = db.getStore().awards.find(a => a.season_id === 6 && a.award_name === 'Galactic Ambassador');

    assert.equal(award.player_id, 'P053');
    assert.equal(award.rank, 1, 'the orphan row held the better rank');
  });

  it('keeps the orphan real vote when the survivor own vote for that week self-destructs', async () => {
    const tables = mergeTables();
    tables.votes = [
      { id: 201, timestamp: 'x', updated_at: null, season_id: 6, week: 9, player_id: 'P053', leader_id: '1', opponent_id: 'P086' },
      { id: 202, timestamp: 'x', updated_at: null, season_id: 6, week: 9, player_id: 'P086', leader_id: '2', opponent_id: 'P004' },
    ];
    const db = createMockDb(tables);

    const result = await handleApproveRename({ requestId: 1, adminToken: ADMIN, confirmMerge: true }, env(db));
    const votes = db.getStore().votes;

    assert.equal(votes.length, 1, 'the week must not end up with zero votes');
    assert.deepEqual([votes[0].player_id, votes[0].opponent_id], ['P053', 'P004']);
    assert.equal(votes[0].id, 202, 'the orphan vote is the one that survives');
    assert.match(result.note, /votes 1,/);
  });

  it('collapses two legacy NULL-melee-id copies of the same match', async () => {
    const tables = mergeTables();
    tables.match_results = [
      { id: 21, season_id: 6, round: 9, melee_match_id: null, player1_id: 'P053', player2_id: 'P004', winner_id: 'P053', result: '2-0', is_bye: 0 },
      { id: 22, season_id: 6, round: 9, melee_match_id: null, player1_id: 'P086', player2_id: 'P004', winner_id: 'P086', result: '2-0', is_bye: 0 },
    ];
    const db = createMockDb(tables);

    await handleApproveRename({ requestId: 1, adminToken: ADMIN, confirmMerge: true }, env(db));
    const rows = db.getStore().match_results;

    assert.equal(rows.length, 1, 'the same pairing in the same round is one match');
    assert.deepEqual([rows[0].player1_id, rows[0].player2_id], ['P053', 'P004']);
  });

  it('never lets PLAYER_SEQ move backwards', async () => {
    const tables = mergeTables();
    tables.settings.push({ key: 'PLAYER_SEQ', value: '090' });
    const db = createMockDb(tables);

    await handleApproveRename({ requestId: 1, adminToken: ADMIN, confirmMerge: true }, env(db));

    assert.equal(db.getStore().settings.find(s => s.key === 'PLAYER_SEQ').value, '090');
  });

  it('refuses two orphans carrying different emails instead of dropping one', async () => {
    const tables = mergeTables();
    tables.players.push(
      { id: 'P091', name: 'Ola_la', melee_name: 'ola_la', melee_guid: null, email: 'other@test.com', active: 1 },
    );
    tables.players = tables.players.map(p => p.id === 'P086' ? { ...p, email: 'mine@test.com' } : p);
    const db = createMockDb(tables);

    await assert.rejects(
      () => buildMergePlan(db, 'P053', ['P086', 'P091']),
      (err) => err.status === 400 && /different emails/.test(err.message)
    );
  });

  it('keeps merged-away ids out of circulation (PLAYER_SEQ)', async () => {
    const db = createMockDb(mergeTables());
    await handleApproveRename({ requestId: 1, adminToken: ADMIN, confirmMerge: true }, env(db));
    const seq = db.getStore().settings.find(s => s.key === 'PLAYER_SEQ');
    assert.equal(seq.value, '86', 'the deleted highest id is retired');

    const finder = createPlayerFinder(db);
    const id = await finder.find('brand_new_user', 'Brand New');
    assert.equal(id, 'P087', 'a later auto-create must not recycle P086');
  });

  it('drops orphan rows that collide on a UNIQUE key (survivor wins)', async () => {
    const db = createMockDb(mergeTables());
    await handleApproveRename({ requestId: 1, adminToken: ADMIN, confirmMerge: true }, env(db));
    const week10 = db.getStore().attendance.filter(a => a.season_id === 6 && a.week === 10);
    assert.equal(week10.length, 1, 'duplicate attendance row dropped');
    assert.equal(week10[0].player_id, 'P053');
  });

  it('is idempotent on double approval', async () => {
    const db = createMockDb(mergeTables());
    await handleApproveRename({ requestId: 1, adminToken: ADMIN, confirmMerge: true }, env(db));
    const again = await handleApproveRename({ requestId: 1, adminToken: ADMIN, confirmMerge: true }, env(db));
    assert.equal(again.alreadyApproved, true);
    assert.equal(db.getStore().player_usernames.filter(r => r.player_id === 'P053' && r.melee_name === 'Takras_Ola').length, 1);
    assert.ok(!db.getStore().players.some(p => p.id === 'P086'));
  });

  it('re-applies an approved request whose batch never landed', async () => {
    const tables = seedHistory(basicTables(), []);
    tables.rename_requests = [
      { id: 1, player_id: 'P001', old_melee_name: 'alice42', new_melee_name: 'alice_two', status: 'approved', melee_hint: null, requested_at: '2026-11-10T10:00:00.000Z', resolved_at: '2026-11-10T11:00:00.000Z', resolved_by: 'admin', note: null },
    ];
    const db = createMockDb(tables);

    const result = await handleApproveRename({ requestId: 1, adminToken: ADMIN }, env(db));

    assert.equal(result.status, 'approved');
    assert.equal(result.alreadyApproved, undefined, 'this was a recovery, not a no-op');
    assert.equal(db.getStore().players.find(p => p.id === 'P001').melee_name, 'alice_two');
    assert.ok(db.getStore().player_usernames.some(r => r.player_id === 'P001' && r.melee_name === 'alice42'));
  });

  it('returns early when the approved request is already reflected on the player', async () => {
    const tables = seedHistory(basicTables(), []);
    tables.players = tables.players.map(p => p.id === 'P001' ? { ...p, melee_name: 'alice_two' } : p);
    tables.rename_requests = [
      { id: 1, player_id: 'P001', old_melee_name: 'alice42', new_melee_name: 'alice_two', status: 'approved', melee_hint: null, requested_at: '2026-11-10T10:00:00.000Z', resolved_at: '2026-11-10T11:00:00.000Z', resolved_by: 'admin', note: null },
    ];
    const db = createMockDb(tables);

    const result = await handleApproveRename({ requestId: 1, adminToken: ADMIN }, env(db));

    assert.equal(result.alreadyApproved, true);
    assert.equal(db.getStore().player_usernames.length, 0, 'no duplicate history write');
  });

  it('refuses to replay an approved request after a later rename moved the player on', async () => {
    const tables = seedHistory(basicTables(), []);
    tables.players = tables.players.map(p => p.id === 'P001' ? { ...p, melee_name: 'alice_three' } : p);
    tables.rename_requests = [
      { id: 1, player_id: 'P001', old_melee_name: 'alice42', new_melee_name: 'alice_two', status: 'approved', melee_hint: null, requested_at: '2026-11-10T10:00:00.000Z', resolved_at: '2026-11-10T11:00:00.000Z', resolved_by: 'admin', note: null },
    ];
    const db = createMockDb(tables);

    const result = await handleApproveRename({ requestId: 1, adminToken: ADMIN }, env(db));

    assert.equal(result.alreadyApproved, true);
    assert.equal(db.getStore().players.find(p => p.id === 'P001').melee_name, 'alice_three', 'a replay must not undo a later rename');
    assert.equal(db.getStore().player_usernames.length, 0);
  });

  it('refuses to approve a rejected request', async () => {
    const tables = seedHistory(basicTables(), []);
    tables.rename_requests = [
      { id: 1, player_id: 'P001', old_melee_name: 'alice42', new_melee_name: 'alice_two', status: 'rejected', melee_hint: null, requested_at: '2026-11-10T10:00:00.000Z', resolved_at: '2026-11-10T11:00:00.000Z', resolved_by: 'admin', note: null },
    ];
    const db = createMockDb(tables);
    await assert.rejects(
      () => handleApproveRename({ requestId: 1, adminToken: ADMIN }, env(db)),
      (err) => err.status === 400
    );
  });

  it('supports the admin-direct form without a member request (create + approve)', async () => {
    const db = createMockDb(seedHistory(basicTables(), []));
    const result = await handleApproveRename(
      { playerId: 'P002', newMeleeName: 'bob_two', adminToken: ADMIN },
      env(db)
    );
    assert.equal(result.status, 'approved');
    assert.equal(db.getStore().players.find(p => p.id === 'P002').melee_name, 'bob_two');
    const row = db.getStore().rename_requests[0];
    assert.equal(row.status, 'approved');
    assert.equal(row.note, 'admin-direct');
  });

  it('refuses a name held by another player who has an email', async () => {
    const db = createMockDb(seedHistory(basicTables(), []));
    await assert.rejects(
      () => handleApproveRename({ playerId: 'P001', newMeleeName: 'bob55', adminToken: ADMIN }, env(db)),
      (err) => err.status === 400
    );
  });
});

describe('handleRejectRename', () => {
  function rejectedTables(status = 'pending') {
    const tables = seedHistory(basicTables(), []);
    tables.rename_requests = [
      { id: 1, player_id: 'P001', old_melee_name: 'alice42', new_melee_name: 'alice_two', status, melee_hint: null, requested_at: '2026-11-10T10:00:00.000Z', resolved_at: null, resolved_by: null, note: null },
    ];
    return tables;
  }

  it('requires the admin token', async () => {
    const db = createMockDb(rejectedTables());
    await assert.rejects(
      () => handleRejectRename({ requestId: 1 }, env(db)),
      (err) => err.status === 403
    );
  });

  it('marks the request rejected and stores the note', async () => {
    const db = createMockDb(rejectedTables());
    const result = await handleRejectRename({ requestId: 1, note: 'Not your handle', adminToken: ADMIN }, env(db));
    assert.equal(result.status, 'rejected');
    const row = db.getStore().rename_requests[0];
    assert.equal(row.status, 'rejected');
    assert.equal(row.note, 'Not your handle');
    assert.ok(row.resolved_at);
  });

  it('is idempotent for an already-rejected request', async () => {
    const db = createMockDb(rejectedTables('rejected'));
    const result = await handleRejectRename({ requestId: 1, adminToken: ADMIN }, env(db));
    assert.equal(result.alreadyRejected, true);
  });

  it('cannot reject an approved request', async () => {
    const db = createMockDb(rejectedTables('approved'));
    await assert.rejects(
      () => handleRejectRename({ requestId: 1, adminToken: ADMIN }, env(db)),
      (err) => err.status === 400
    );
  });
});

describe('handleMergePlayers', () => {
  it('requires the admin token', async () => {
    const db = createMockDb(mergeTables());
    await assert.rejects(
      () => handleMergePlayers({ survivorId: 'P053', orphanId: 'P086' }, env(db)),
      (err) => err.status === 403
    );
  });

  it('merges as a standalone admin action', async () => {
    const db = createMockDb(mergeTables());
    const result = await handleMergePlayers(
      { survivorId: 'P053', orphanId: 'P086', adminToken: ADMIN },
      env(db)
    );
    assert.equal(result.orphanId, 'P086');
    assert.equal(result.summary.matches, 2);
    assert.ok(!db.getStore().players.some(p => p.id === 'P086'));
  });

  it('refuses to merge a player into itself', async () => {
    const db = createMockDb(mergeTables());
    await assert.rejects(
      () => handleMergePlayers({ survivorId: 'P053', orphanId: 'P053', adminToken: ADMIN }, env(db)),
      (err) => err.status === 400
    );
  });

  it('refuses to merge rows with two different emails', async () => {
    const tables = mergeTables();
    tables.players = tables.players.map(p => p.id === 'P086' ? { ...p, email: 'other@test.com' } : p);
    const db = createMockDb(tables);
    await assert.rejects(
      () => handleMergePlayers({ survivorId: 'P053', orphanId: 'P086', adminToken: ADMIN }, env(db)),
      (err) => err.status === 400
    );
  });
});

describe('getAppData – renameRequest status', () => {
  it('returns the caller\'s latest request and null when none exists', async () => {
    const tables = seedHistory(basicTables(), []);
    const db = createMockDb(tables);
    const empty = await handleGetAppData({}, env(db), SESSION);
    assert.equal(empty.renameRequest, null);

    db.getStore().rename_requests.push({
      id: 7, player_id: 'P001', old_melee_name: 'alice42', new_melee_name: 'alice_two',
      status: 'pending', melee_hint: 'found', requested_at: '2026-11-10T10:00:00.000Z',
      resolved_at: null, resolved_by: null, note: null,
    });
    const withRequest = await handleGetAppData({}, env(db), SESSION);
    assert.deepEqual(withRequest.renameRequest, {
      status: 'pending',
      oldMeleeName: 'alice42',
      newMeleeName: 'alice_two',
      requestedAt: '2026-11-10T10:00:00.000Z',
      note: null,
    });

    const otherPlayer = await handleGetAppData({}, env(db), { player_id: 'P002', device_id: 'dev-bob' });
    assert.equal(otherPlayer.renameRequest, null, 'requests are not visible to other players');
  });

  it('surfaces the rejection reason to the member, but never the internal merge note', async () => {
    const tables = seedHistory(basicTables(), []);
    tables.rename_requests = [
      { id: 1, player_id: 'P001', old_melee_name: 'alice42', new_melee_name: 'alice_two', status: 'rejected', melee_hint: null, requested_at: '2026-11-10T10:00:00.000Z', resolved_at: '2026-11-10T11:00:00.000Z', resolved_by: 'admin', note: 'That handle belongs to someone else' },
      { id: 2, player_id: 'P001', old_melee_name: 'alice42', new_melee_name: 'alice_three', status: 'approved', melee_hint: null, requested_at: '2026-11-09T10:00:00.000Z', resolved_at: '2026-11-09T11:00:00.000Z', resolved_by: 'admin', note: 'merged: votes 2, dropped 1 duplicate row(s)' },
    ];
    const db = createMockDb(tables);
    const result = await handleGetAppData({}, env(db), SESSION);
    assert.equal(result.renameRequest.status, 'rejected');
    assert.equal(result.renameRequest.note, 'That handle belongs to someone else');

    db.getStore().rename_requests = db.getStore().rename_requests.filter(r => r.id === 2);
    const approved = await handleGetAppData({}, env(db), SESSION);
    assert.equal(approved.renameRequest.status, 'approved');
    assert.equal(approved.renameRequest.note, null, 'merge internals stay private');
  });
});

describe('E2E – declared rename survives the next sync round', () => {
  it('maps the new username to the same P### and creates no orphan', async () => {
    const tables = basicTables();
    tables.players.push({ id: 'P053', name: 'Takras_Ola', melee_name: 'Takras_Ola', melee_guid: null, email: 'ola@test.com', active: 1 });
    tables.player_usernames = [
      { player_id: 'P053', melee_name: 'Takras_Ola', name_lower: 'takras_ola', source: 'seed', first_seen: null, last_seen: '2026-01-01T00:00:00.000Z' },
      { player_id: 'P053', melee_name: 'ola_la', name_lower: 'ola_la', source: 'admin', first_seen: null, last_seen: '2026-11-01T00:00:00.000Z' },
    ];
    tables.melee_tournaments = [{ melee_id: 500, season_id: 6, round: 10, name: 'Week 10', phase: 'regular' }];
    const db = createMockDb(tables);
    const client = {
      getStandings: async () => ({
        Content: [{
          Rank: 1, Points: 9, MatchWins: 3, MatchLosses: 0, MatchDraws: 0,
          Team: { Players: [{ Username: 'ola_la', DisplayName: 'ola_la' }] },
        }],
      }),
      getMatches: async () => ({ Content: [] }),
    };
    const weekMap = new Map([[500, {
      meleeId: 500, round: 10, name: 'Week 10', date: '2026-11-11', phase: 'regular',
      status: 4, statusDescription: 'Ended',
    }]]);

    const result = await syncSeasonData(db, client, { seasonId: 6, weekMap, maxAttendanceWeek: 10 });

    assert.equal(result.createdPlayers.length, 0, 'no orphan auto-created');
    assert.equal(db.getStore().season_standings[0].player_id, 'P053');
    assert.ok(!db.getStore().players.some(p => p.melee_name === 'ola_la'));
  });
});
