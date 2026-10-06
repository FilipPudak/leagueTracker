import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { decideWinner, resolveMeleeName, resolveMatchCompetitors, syncSeasonData } from '../../src/lib/leagueSync.js';
import { createMockDb } from '../helpers/mock-db.js';
import { basicTables } from '../helpers/fixtures.js';

function finderStub(map = {}) {
  return {
    async find(username) {
      if (map[username]) return map[username];
      throw new Error(`unexpected finder lookup: ${username}`);
    },
  };
}

describe('lib/leagueSync pure helpers (P4 Phase 1)', () => {
  it('T1.1 decideWinner returns p1 when p1 has more game wins', () => {
    assert.equal(decideWinner(2, 1, 'P001', 'P002'), 'P001');
  });

  it('T1.1 decideWinner returns p2 when p2 has more game wins', () => {
    assert.equal(decideWinner(0, 2, 'P001', 'P002'), 'P002');
  });

  it('T1.1 decideWinner returns null on equal game wins (draw)', () => {
    assert.equal(decideWinner(1, 1, 'P001', 'P002'), null);
  });

  it('T1.2 resolveMeleeName prefers DisplayName over Name and username', () => {
    assert.equal(resolveMeleeName({ DisplayName: 'Gold Leader', Name: 'Alice', Username: 'alice42' }, 'alice42'), 'Gold Leader');
  });

  it('T1.2 resolveMeleeName falls back to Name when DisplayName missing', () => {
    assert.equal(resolveMeleeName({ Name: 'Alice', Username: 'alice42' }, 'alice42'), 'Alice');
  });

  it('T1.2 resolveMeleeName falls back to username when both names missing', () => {
    assert.equal(resolveMeleeName({ Username: 'alice42' }, 'alice42'), 'alice42');
  });

  it('T1.2 resolveMeleeName uses the passed username when player object lacks names', () => {
    assert.equal(resolveMeleeName({}, 'alice42'), 'alice42');
  });

  it('T1.2 resolveMeleeName tolerates a null player object', () => {
    assert.equal(resolveMeleeName(null, 'alice42'), 'alice42');
  });

  it('T1.3 resolveMatchCompetitors resolves both slots to player ids', async () => {
    const comps = [
      { Team: { Players: [{ Username: 'alice42', DisplayName: 'Alice' }] } },
      { Team: { Players: [{ Username: 'bob55', Name: 'Bob' }] } },
    ];
    const ids = await resolveMatchCompetitors(comps, finderStub({ alice42: 'P001', bob55: 'P002' }));
    assert.deepEqual(ids, { p1Id: 'P001', p2Id: 'P002' });
  });

  it('T1.3 resolveMatchCompetitors returns null when p1 lacks a username', async () => {
    const comps = [
      { Team: { Players: [{ DisplayName: 'Ghost' }] } },
      { Team: { Players: [{ Username: 'bob55' }] } },
    ];
    assert.equal(await resolveMatchCompetitors(comps, finderStub({ bob55: 'P002' })), null);
  });

  it('T1.3 resolveMatchCompetitors returns null when p2 lacks a username', async () => {
    const comps = [
      { Team: { Players: [{ Username: 'alice42' }] } },
      { Team: { Players: [{ Username: '' }] } },
    ];
    assert.equal(await resolveMatchCompetitors(comps, finderStub({ alice42: 'P001' })), null);
  });

  it('T1.3 resolveMatchCompetitors returns null when a competitor slot is missing', async () => {
    const comps = [{ Team: { Players: [{ Username: 'alice42' }] } }];
    assert.equal(await resolveMatchCompetitors(comps, finderStub({ alice42: 'P001' })), null);
  });
});

const STANDINGS = [
  { Rank: 1, Points: 9, MatchWins: 3, MatchDraws: 0, MatchLosses: 0, Team: { Players: [{ Username: 'alice42', ID: 'g1' }] } },
  { Rank: 2, Points: 6, MatchWins: 2, MatchDraws: 0, MatchLosses: 1, Team: { Players: [{ Username: 'bob55', ID: 'g2' }] } },
  { Rank: 3, Points: 3, MatchWins: 1, MatchDraws: 0, MatchLosses: 2, Team: { Players: [{ Username: 'charlie99', ID: 'g3' }] } },
];

const MATCHES = [
  { ID: 500, Competitors: [
    { Team: { Players: [{ Username: 'alice42', ID: 'g1' }] }, GameWins: 2 },
    { Team: { Players: [{ Username: 'bob55', ID: 'g2' }] }, GameWins: 1 },
  ], ByeReason: null },
  { ID: 501, Competitors: [
    { Team: { Players: [{ Username: 'alice42', ID: 'g1' }] }, GameWins: 2 },
    { Team: { Players: [{ Username: 'charlie99', ID: 'g3' }] }, GameWins: 0 },
  ], ByeReason: null },
  { ID: 502, Competitors: [
    { Team: { Players: [{ Username: 'bob55', ID: 'g2' }] }, GameWins: 2 },
    { Team: { Players: [{ Username: 'charlie99', ID: 'g3' }] }, GameWins: 1 },
  ], ByeReason: null },
];

function engineTables() {
  const t = basicTables();
  t.melee_tournaments = [];
  t.season_standings = [];
  t.match_results = [];
  t.attendance = [];
  return t;
}

function makeWeekMap(entries) {
  return new Map(entries.map(e => [e.meleeId, {
    meleeId: e.meleeId,
    round: e.round,
    name: e.name || `SWU Wednesday league season 6 ${e.round}/1 (week ${e.round})`,
    date: '2026-01-01T19:00:00',
    phase: e.phase || 'regular',
  }]));
}

function engineClient({ standings = {}, matches = {}, failStandings = [], failMatches = [] } = {}) {
  const calls = { standings: [], matches: [], list: 0 };
  return {
    calls,
    async listTournaments() {
      calls.list += 1;
      throw new Error('engine must not call listTournaments');
    },
    async getStandings(id) {
      calls.standings.push(id);
      if (failStandings.includes(id)) throw new Error('standings down');
      return { Content: standings[id] ?? STANDINGS };
    },
    async getMatches(id) {
      calls.matches.push(id);
      if (failMatches.includes(id)) throw new Error('matches down');
      return { Content: matches[id] ?? MATCHES };
    },
  };
}

function hasAuditLog(logSpy, warnSpy) {
  const seen = [...logSpy.mock.calls, ...warnSpy.mock.calls].map(c => String(c.arguments[0]));
  return seen.filter(s => s.includes('[VoteAudit]'));
}

describe('lib/leagueSync syncSeasonData (P4 Phase 2)', () => {
  it('T1.4 skips standings rows without a username', async () => {
    const db = createMockDb(engineTables());
    const client = engineClient({ standings: { 201: [
      STANDINGS[0],
      { Rank: 2, Points: 6, MatchWins: 2, MatchDraws: 0, MatchLosses: 1, Team: { Players: [{ DisplayName: 'Ghost' }] } },
    ] } });

    const result = await syncSeasonData(db, client, {
      seasonId: 6,
      weekMap: makeWeekMap([{ meleeId: 201, round: 1 }]),
    });

    const rows = db.getStore().season_standings;
    assert.equal(rows.length, 1, 'username-less entry produces no row');
    assert.ok(rows.every(r => r.player_id), 'no null-player rows');
    assert.equal(result.standingsRows, 1);
  });

  it('T2.1 syncs standings for one round and tallies standingsRows', async () => {
    const db = createMockDb(engineTables());
    const client = engineClient();

    const result = await syncSeasonData(db, client, {
      seasonId: 6,
      weekMap: makeWeekMap([{ meleeId: 201, round: 1 }]),
    });

    const rows = db.getStore().season_standings.filter(s => s.season_id === 6 && s.round === 1);
    assert.equal(rows.length, 3);
    const alice = rows.find(r => r.player_id === 'P001');
    assert.equal(alice.wins, 3);
    assert.equal(alice.match_points, 9);
    assert.equal(alice.rank, 1);
    assert.equal(result.standingsRows, 3);
    assert.equal(result.roundsProcessed, 1);
    assert.equal(result.fetchFailed, false);
  });

  it('T2.2 syncs matches with decided winners', async () => {
    const db = createMockDb(engineTables());
    const client = engineClient();

    const result = await syncSeasonData(db, client, {
      seasonId: 6,
      weekMap: makeWeekMap([{ meleeId: 201, round: 1 }]),
    });

    const rows = db.getStore().match_results;
    assert.equal(rows.length, 3);
    const aliceVsBob = rows.find(m =>
      (m.player1_id === 'P001' && m.player2_id === 'P002') ||
      (m.player1_id === 'P002' && m.player2_id === 'P001')
    );
    assert.ok(aliceVsBob);
    assert.equal(aliceVsBob.winner_id, 'P001');
    assert.equal(result.matchesRows, 3);
    assert.deepEqual([...result.newlySyncedRounds], [1]);
  });

  it('T2.3 auto-creates players from standings and matches (invariant 4)', async () => {
    const db = createMockDb(engineTables());
    const client = engineClient({
      standings: { 201: [
        { Rank: 1, Points: 9, MatchWins: 3, MatchDraws: 0, MatchLosses: 0, Team: { Players: [{ Username: 'alice42' }] } },
        { Rank: 2, Points: 6, MatchWins: 2, MatchDraws: 0, MatchLosses: 1, Team: { Players: [{ Username: 'ghost_player', DisplayName: 'Ghost Display' }] } },
      ] },
      matches: { 201: [
        { ID: 900, Competitors: [
          { Team: { Players: [{ Username: 'ghost_player', DisplayName: 'Ghost Display' }] }, GameWins: 2 },
          { Team: { Players: [{ Username: 'nobody_here' }] }, GameWins: 0 },
        ], ByeReason: null },
      ] },
    });

    const result = await syncSeasonData(db, client, {
      seasonId: 6,
      weekMap: makeWeekMap([{ meleeId: 201, round: 1 }]),
    });

    const store = db.getStore();
    const ghost = store.players.find(p => p.melee_name === 'ghost_player');
    const nobody = store.players.find(p => p.melee_name === 'nobody_here');
    assert.ok(ghost, 'ghost auto-created from standings');
    assert.equal(ghost.name, 'Ghost Display');
    assert.equal(ghost.active, 1);
    assert.ok(nobody, 'nobody auto-created from matches');
    assert.equal(nobody.name, 'nobody_here');
    assert.equal(store.season_standings.length, 2);
    assert.equal(store.match_results.length, 1);
    assert.equal(store.match_results[0].winner_id, ghost.id);
    assert.equal(result.createdPlayers.length, 2);
    assert.ok(result.createdPlayers.some(p => p.id === ghost.id && p.melee_name === 'ghost_player'));
  });

  it('T2.4 writes attendance for regular phase only', async () => {
    const db = createMockDb(engineTables());
    const client = engineClient();

    const result = await syncSeasonData(db, client, {
      seasonId: 6,
      weekMap: makeWeekMap([
        { meleeId: 201, round: 1 },
        { meleeId: 212, round: 12, phase: 'cut' },
      ]),
    });

    const store = db.getStore();
    assert.equal(store.attendance.filter(a => a.week === 1).length, 3, 'regular round attendance written');
    assert.equal(store.attendance.filter(a => a.week === 12).length, 0, 'cut round attendance excluded');
    assert.equal(result.roundPhases.get(12), 'cut');
    assert.equal(result.attendanceRows, 3);
  });

  it('T2.5 skips a round when both standings and matches already exist', async () => {
    const tables = engineTables();
    tables.season_standings = [
      { season_id: 6, round: 1, player_id: 'P001', wins: 3, losses: 0, draws: 0, match_points: 9, rank: 1 },
    ];
    tables.match_results = [
      { season_id: 6, round: 1, melee_match_id: 'm-1', player1_id: 'P001', player2_id: 'P002', winner_id: 'P001', result: '2-0', is_bye: 0 },
    ];
    const db = createMockDb(tables);
    const client = engineClient();

    const result = await syncSeasonData(db, client, {
      seasonId: 6,
      weekMap: makeWeekMap([{ meleeId: 201, round: 1 }]),
    });

    assert.equal(result.roundsSkipped, 1);
    assert.equal(result.roundsProcessed, 0);
    assert.equal(client.calls.standings.length, 0, 'no standings fetch');
    assert.equal(client.calls.matches.length, 0, 'no matches fetch');
    assert.equal(db.getStore().season_standings.length, 1, 'seed row untouched');
  });

  it('T2.6 force bypasses the skip predicate and replaces the round', async () => {
    const tables = engineTables();
    tables.season_standings = [
      { season_id: 6, round: 1, player_id: 'P009', wins: 0, losses: 3, draws: 0, match_points: 0, rank: 9 },
    ];
    tables.match_results = [
      { season_id: 6, round: 1, melee_match_id: 'old-guid', player1_id: 'P009', player2_id: 'P002', winner_id: 'P002', result: '0-2', is_bye: 0 },
    ];
    const db = createMockDb(tables);
    const client = engineClient();

    const result = await syncSeasonData(db, client, {
      seasonId: 6,
      weekMap: makeWeekMap([{ meleeId: 201, round: 1 }]),
      force: true,
    });

    const store = db.getStore();
    assert.equal(result.roundsSkipped, 0);
    assert.equal(result.roundsResynced, 1);
    assert.equal(client.calls.standings.length, 1, 'force fetches despite existing data');
    assert.ok(!store.season_standings.find(s => s.player_id === 'P009'), 'orphan standing removed');
    assert.ok(!store.match_results.find(m => m.melee_match_id === 'old-guid'), 'orphan match removed');
    assert.equal(store.season_standings.length, 3, 'fresh standings replaced the round');
    assert.equal(store.match_results.length, 3, 'fresh matches replaced the round');
  });

  it('T2.7 incremental re-fetch cleans stale players and stale match guids', async () => {
    const tables = engineTables();
    tables.season_standings = [
      { season_id: 6, round: 1, player_id: 'P001', wins: 3, losses: 0, draws: 0, match_points: 9, rank: 1 },
      { season_id: 6, round: 1, player_id: 'P009', wins: 0, losses: 3, draws: 0, match_points: 0, rank: 9 },
    ];
    tables.match_results = [
      { season_id: 6, round: 2, melee_match_id: 'old-guid', player1_id: 'P001', player2_id: 'P002', winner_id: 'P001', result: '2-0', is_bye: 0 },
    ];
    const db = createMockDb(tables);
    const client = engineClient();

    await syncSeasonData(db, client, {
      seasonId: 6,
      weekMap: makeWeekMap([
        { meleeId: 201, round: 1 },
        { meleeId: 202, round: 2 },
      ]),
    });

    const store = db.getStore();
    assert.ok(!store.season_standings.find(s => s.player_id === 'P009'), 'stale player removed from standings-only round');
    assert.ok(!store.match_results.find(m => m.melee_match_id === 'old-guid'), 'stale guid removed from matches-only round');
    assert.equal(store.season_standings.filter(s => s.round === 2).length, 3, 'round 2 standings written');
    assert.equal(store.match_results.filter(m => m.round === 1).length, 3, 'round 1 matches written');
  });

  it('T2.8 standings fetch failure → round partial, no vote audit', async (t) => {
    const tables = engineTables();
    tables.season_standings = [
      { season_id: 6, round: 1, player_id: 'P001', wins: 3, losses: 0, draws: 0, match_points: 9, rank: 1 },
    ];
    const db = createMockDb(tables);
    const client = engineClient({ failStandings: [201] });
    const logSpy = t.mock.method(console, 'log', () => {});
    const warnSpy = t.mock.method(console, 'warn', () => {});
    const errorSpy = t.mock.method(console, 'error', () => {});

    const result = await syncSeasonData(db, client, {
      seasonId: 6,
      weekMap: makeWeekMap([{ meleeId: 201, round: 1 }]),
      auditVotes: true,
    });

    assert.equal(result.roundsPartial, 1);
    assert.deepEqual([...result.newlySyncedRounds], []);
    assert.equal(result.roundsProcessed, 1);
    assert.equal(client.calls.matches.length, 0, 'matches not fetched after standings failure');
    assert.equal(db.getStore().season_standings.length, 1, 'seed row untouched');
    assert.equal(hasAuditLog(logSpy, warnSpy).length, 0, 'no audit for a partial round');
    assert.ok(errorSpy.mock.calls.length > 0, 'failure logged');
  });

  it('T2.9 matches fetch failure keeps attendance from the response, round partial', async (t) => {
    const db = createMockDb(engineTables());
    const client = engineClient({ failMatches: [201] });
    t.mock.method(console, 'error', () => {});

    const result = await syncSeasonData(db, client, {
      seasonId: 6,
      weekMap: makeWeekMap([{ meleeId: 201, round: 1 }]),
      auditVotes: true,
    });

    const store = db.getStore();
    assert.equal(store.attendance.filter(a => a.week === 1).length, 3, 'attendance still written from response');
    assert.equal(result.roundsPartial, 1);
    assert.equal(result.matchesRows, 0);
    assert.deepEqual([...result.newlySyncedRounds], []);
    assert.equal(result.attendanceRows, 3);
  });

  it('T2.10 never writes settings or awards', async () => {
    const db = createMockDb(engineTables());
    const client = engineClient();
    const before = JSON.stringify({
      settings: db.getStore().settings,
      awards: db.getStore().awards,
    });

    await syncSeasonData(db, client, {
      seasonId: 6,
      weekMap: makeWeekMap([{ meleeId: 201, round: 1 }]),
      reactivate: true,
      auditVotes: true,
    });

    const after = JSON.stringify({
      settings: db.getStore().settings,
      awards: db.getStore().awards,
    });
    assert.equal(after, before, 'settings/awards store untouched');
    const forbidden = db.getCalls().filter(c => /\b(settings|awards)\b/i.test(c.sql));
    assert.equal(forbidden.length, 0, 'no SQL touches settings/awards');
  });

  it('T2.11 uses DB.batch for standings, attendance and matches writes', async () => {
    const db = createMockDb(engineTables());
    const client = engineClient();
    const originalBatch = db.batch.bind(db);
    let batchCalls = 0;
    db.batch = (stmts) => {
      batchCalls += 1;
      return originalBatch(stmts);
    };

    await syncSeasonData(db, client, {
      seasonId: 6,
      weekMap: makeWeekMap([{ meleeId: 201, round: 1 }]),
    });

    assert.equal(batchCalls, 3, 'standings + attendance + matches batches');
    assert.equal(db.getStore().season_standings.length, 3);
    assert.equal(db.getStore().attendance.length, 3);
    assert.equal(db.getStore().match_results.length, 3);
  });

  it('T2.12 a failing mid-batch write leaves the round unchanged', async (t) => {
    const tables = engineTables();
    tables.season_standings = [
      { season_id: 6, round: 1, player_id: 'P001', wins: 3, losses: 0, draws: 0, match_points: 9, rank: 1 },
      { season_id: 6, round: 1, player_id: 'P009', wins: 0, losses: 3, draws: 0, match_points: 0, rank: 9 },
    ];
    const db = createMockDb(tables);
    const dup = STANDINGS[0];
    const client = engineClient({ standings: { 201: [dup, dup] } });
    t.mock.method(console, 'error', () => {});

    const result = await syncSeasonData(db, client, {
      seasonId: 6,
      weekMap: makeWeekMap([{ meleeId: 201, round: 1 }]),
    });

    const store = db.getStore();
    assert.equal(store.season_standings.length, 2, 'round rolled back to seeded rows');
    assert.ok(store.season_standings.find(s => s.player_id === 'P009'), 'stale row survives rollback');
    assert.equal(result.standingsRows, 0);
    assert.equal(result.roundsPartial, 1);
    assert.equal(result.attendanceRows, 0, 'attendance skipped after failed standings batch');
    assert.equal(client.calls.matches.length, 0, 'matches not fetched after failed standings batch');
  });

  it('T2.13 tournament inserts are not budget-gated', async () => {
    const db = createMockDb(engineTables());
    const client = engineClient();
    const entries = Array.from({ length: 13 }, (_, i) => ({ meleeId: 301 + i, round: i + 1 }));

    const result = await syncSeasonData(db, client, {
      seasonId: 6,
      weekMap: makeWeekMap(entries),
      budget: 2,
    });

    assert.equal(db.getStore().melee_tournaments.filter(t => t.season_id === 6).length, 13, 'all tournaments inserted under budget 2');
    assert.equal(result.tournamentsInserted, 13);
    assert.equal(result.roundsProcessed, 2, 'budget caps data-fetch rounds');
    assert.equal(client.calls.standings.length, 2);
  });

  it('T2.14 budget consumption shows up as roundsProcessed and roundsPartial', async () => {
    const db = createMockDb(engineTables());
    const entries = Array.from({ length: 13 }, (_, i) => ({ meleeId: 301 + i, round: i + 1 }));
    const client = engineClient({ failStandings: [301] });

    const result = await syncSeasonData(db, client, {
      seasonId: 6,
      weekMap: makeWeekMap(entries),
      budget: 2,
    });

    assert.equal(result.roundsProcessed, 2);
    assert.equal(result.roundsPartial, 1, 'first round failed, second succeeded');
    assert.equal(result.standingsRows, 3, 'only the healthy round wrote rows');
    assert.equal(client.calls.standings.length, 2, 'fetches stop at the budget');
  });

  it('T2.15 maxAttendanceWeek caps attendance table writes only', async () => {
    const db = createMockDb(engineTables());
    const client = engineClient();

    const result = await syncSeasonData(db, client, {
      seasonId: 6,
      weekMap: makeWeekMap([
        { meleeId: 201, round: 1 },
        { meleeId: 205, round: 5 },
      ]),
      maxAttendanceWeek: 3,
    });

    const store = db.getStore();
    assert.equal(store.attendance.filter(a => a.week === 1).length, 3, 'round within cap writes attendance');
    assert.equal(store.attendance.filter(a => a.week === 5).length, 0, 'round beyond cap writes no attendance');
    assert.equal(result.standingsRows, 6, 'standings unaffected by the cap');
    assert.equal(result.matchesRows, 6, 'matches unaffected by the cap');
  });

  it('T2.16 reactivate uses the full uncapped roundAttendance', async () => {
    const tables = engineTables();
    tables.players.find(p => p.id === 'P005').active = 0;
    const db = createMockDb(tables);
    const client = engineClient({
      standings: { 205: [
        ...STANDINGS,
        { Rank: 4, Points: 0, MatchWins: 0, MatchDraws: 0, MatchLosses: 3, Team: { Players: [{ Username: 'eve00' }] } },
      ] },
    });

    await syncSeasonData(db, client, {
      seasonId: 6,
      weekMap: makeWeekMap([
        { meleeId: 201, round: 1 },
        { meleeId: 205, round: 5 },
      ]),
      maxAttendanceWeek: 3,
      reactivate: true,
    });

    const store = db.getStore();
    assert.equal(store.attendance.filter(a => a.week === 5).length, 0, 'cap still blocks the attendance row');
    assert.equal(store.players.find(p => p.id === 'P005').active, 1, 'reactivation saw the uncapped set');
  });

  it('T2.17 vote audit runs after attendance for the same round', async (t) => {
    const db = createMockDb(engineTables());
    const client = engineClient();
    const logSpy = t.mock.method(console, 'log', () => {});
    const warnSpy = t.mock.method(console, 'warn', () => {});

    await syncSeasonData(db, client, {
      seasonId: 6,
      weekMap: makeWeekMap([{ meleeId: 201, round: 1 }]),
      auditVotes: true,
    });

    const auditLines = hasAuditLog(logSpy, warnSpy);
    assert.equal(auditLines.length, 1, 'audit emitted for the synced round');
    assert.match(auditLines[0], /reconciled, no violations/, 'audit saw attendance written before it ran');
    assert.match(auditLines[0], /S6 W1/);
  });

  it('T2.18 auditVotes false emits no VoteAudit logs', async (t) => {
    const db = createMockDb(engineTables());
    const client = engineClient();
    const logSpy = t.mock.method(console, 'log', () => {});
    const warnSpy = t.mock.method(console, 'warn', () => {});

    await syncSeasonData(db, client, {
      seasonId: 6,
      weekMap: makeWeekMap([{ meleeId: 201, round: 1 }]),
    });

    assert.equal(hasAuditLog(logSpy, warnSpy).length, 0);
    assert.equal(db.getStore().match_results.length, 3, 'sync itself still ran');
  });

  it('T2.19 each round is processed at most once per call (skip-set snapshot)', async () => {
    const db = createMockDb(engineTables());
    const client = engineClient();

    const result = await syncSeasonData(db, client, {
      seasonId: 6,
      weekMap: makeWeekMap([
        { meleeId: 201, round: 1 },
        { meleeId: 202, round: 1 },
      ]),
    });

    assert.equal(client.calls.standings.length, 1, 'second entry for the same round is not fetched');
    assert.equal(result.roundsProcessed, 1);
    assert.equal(db.getStore().season_standings.length, 3, 'one round of rows, not two');
  });

  it('T2.20 never calls listTournaments', async () => {
    const db = createMockDb(engineTables());
    const client = engineClient();

    const result = await syncSeasonData(db, client, {
      seasonId: 6,
      weekMap: makeWeekMap([{ meleeId: 201, round: 1 }]),
    });

    assert.equal(client.calls.list, 0);
    assert.equal(result.fetchFailed, false);
  });
});
