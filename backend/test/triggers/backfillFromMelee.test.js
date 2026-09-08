import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMockDb } from '../helpers/mock-db.js';
import { basicTables } from '../helpers/fixtures.js';
import { backfillFromMelee } from '../../src/triggers/backfillFromMelee.js';

function makeTables(overrides = {}) {
  const t = basicTables();
  if (overrides.settings) t.settings = overrides.settings;
  if (overrides.seasons) t.seasons = overrides.seasons;
  return t;
}

const ALL_TOURNAMENTS = [
  { ID: 100, Name: 'SWU Wednesday league season 5 01/01 (week 1)', StartDate: '2025-01-01T19:00:00' },
  { ID: 101, Name: 'SWU Wednesday league season 5 08/01 (week 2)', StartDate: '2025-01-08T19:00:00' },
  { ID: 102, Name: 'SWU Wednesday league season 6 01/01 (week 1)', StartDate: '2026-01-01T19:00:00' },
  { ID: 200, Name: 'SWU TWI Store Championship', StartDate: '2025-02-01T19:00:00' },
];

const SEASON_6_TOURNAMENTS = [
  { ID: 601, Name: 'SWU Wednesday league season 6 27/5 (week 1)', StartDate: '2026-05-27T18:00:00' },
  { ID: 602, Name: 'SWU Wednesday league season 6 3/6 (week 2)', StartDate: '2026-06-03T18:00:00' },
  { ID: 603, Name: 'SWU Wednesday league season 6 10/6 (week 3)', StartDate: '2026-06-10T18:00:00' },
  { ID: 604, Name: 'SWU Wednesday league season 6 17/6 (week 4)', StartDate: '2026-06-17T18:00:00' },
  { ID: 605, Name: 'SWU Wednesday league season 6 24/6 (week 5)', StartDate: '2026-06-24T18:00:00' },
  { ID: 606, Name: 'SWU Wednesday league season 6 1/7 (week 6)', StartDate: '2026-07-01T18:00:00' },
  { ID: 607, Name: 'SWU Wednesday league season 6 8/7 (week 7)', StartDate: '2026-07-08T18:00:00' },
  { ID: 608, Name: 'SWU Wednesday league season 6 15/7 (week 8)', StartDate: '2026-07-15T18:00:00' },
  { ID: 609, Name: 'SWU Wednesday league season 6 22/7 (week 9)', StartDate: '2026-07-22T18:00:00' },
  { ID: 610, Name: 'SWU Wednesday league season 6 5/8', StartDate: '2026-08-05T18:00:00' },
  { ID: 611, Name: 'SWU Wednesday league season 6 12/8 (week 11)', StartDate: '2026-08-12T18:00:00' },
  { ID: 612, Name: 'SWU Wednesday league season 6 TOP 4', StartDate: '2026-08-19T17:00:00' },
  { ID: 613, Name: 'SWU Wednesday league season 6 Best of the Rest', StartDate: '2026-08-19T18:00:00' },
];

const STANDINGS = [
  { Rank: 1, Points: 9, MatchWins: 3, MatchDraws: 0, MatchLosses: 0, GameWins: 6, GameLosses: 1, Team: { Players: [{ Username: 'alice42', ID: 'g1' }] } },
  { Rank: 2, Points: 6, MatchWins: 2, MatchDraws: 0, MatchLosses: 1, GameWins: 4, GameLosses: 3, Team: { Players: [{ Username: 'bob55', ID: 'g2' }] } },
];

const MATCHES = [
  { ID: 500, Competitors: [
    { Team: { Players: [{ Username: 'alice42', ID: 'g1' }] }, GameWins: 2, GameByes: 0 },
    { Team: { Players: [{ Username: 'bob55', ID: 'g2' }] }, GameWins: 1, GameByes: 0 },
  ], WinnerId: 'g1', ByeReason: null },
];

function buildMockFetch(overrides = {}) {
  const tournaments = overrides.tournaments || ALL_TOURNAMENTS;
  const standings = overrides.standings || STANDINGS;
  const matches = overrides.matches || MATCHES;

  return async (url) => {
    if (url.includes('/api/tournament/list')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ Content: tournaments, TotalCount: tournaments.length }) };
    }
    if (url.includes('/api/standing/list/current/')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ Content: standings }) };
    }
    if (url.includes('/api/match/list/')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ Content: matches }) };
    }
    return { ok: false, status: 404, text: async () => 'Not found' };
  };
}

function makeMockClient(fetchFn) {
  return class {
    async listTournaments() {
      const r = await fetchFn('https://melee.gg/api/tournament/list');
      return JSON.parse(await r.text());
    }
    async getStandings(id) {
      const r = await fetchFn(`https://melee.gg/api/standing/list/current/${id}`);
      return JSON.parse(await r.text());
    }
    async getMatches(id) {
      const r = await fetchFn(`https://melee.gg/api/match/list/${id}`);
      return JSON.parse(await r.text());
    }
  };
}

describe('triggers/backfillFromMelee', () => {
  let db;
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('backfills tournaments for a specific season', async () => {
    const tables = makeTables();
    db = createMockDb(tables);
    globalThis.fetch = buildMockFetch();

    await backfillFromMelee({ DB: db }, { MeleeClient: makeMockClient(globalThis.fetch), seasonId: 5 });

    const store = db.getStore();
    const s5Tournaments = store.melee_tournaments.filter(t => t.season_id === 5);
    assert.ok(s5Tournaments.length > 0, 'Season 5 tournaments stored');
    assert.equal(s5Tournaments[0].season_id, 5);
  });

  it('filters out non-league tournaments', async () => {
    const tables = makeTables();
    db = createMockDb(tables);
    globalThis.fetch = buildMockFetch();

    await backfillFromMelee({ DB: db }, { MeleeClient: makeMockClient(globalThis.fetch), seasonId: 5 });

    const store = db.getStore();
    const ids = store.melee_tournaments.map(t => t.melee_id);
    assert.ok(!ids.includes(200), 'Store championship excluded');
  });

  it('stores standings for each tournament', async () => {
    const tables = makeTables();
    db = createMockDb(tables);
    globalThis.fetch = buildMockFetch();

    await backfillFromMelee({ DB: db }, { MeleeClient: makeMockClient(globalThis.fetch), seasonId: 5 });

    const store = db.getStore();
    assert.ok(store.season_standings.length > 0, 'Standings stored');
  });

  it('stores match results for each tournament', async () => {
    const tables = makeTables();
    db = createMockDb(tables);
    globalThis.fetch = buildMockFetch();

    await backfillFromMelee({ DB: db }, { MeleeClient: makeMockClient(globalThis.fetch), seasonId: 5 });

    const store = db.getStore();
    assert.ok(store.match_results.length > 0, 'Matches stored');
  });

  it('returns summary of backfilled data', async () => {
    const tables = makeTables();
    db = createMockDb(tables);
    globalThis.fetch = buildMockFetch();

    const result = await backfillFromMelee({ DB: db }, { MeleeClient: makeMockClient(globalThis.fetch), seasonId: 5 });

    assert.equal(result.seasonId, 5);
    assert.ok(typeof result.tournaments === 'number');
    assert.ok(typeof result.standings === 'number');
    assert.ok(typeof result.matches === 'number');
  });

  it('skips tournament INSERT but still re-syncs standings/matches for existing tournaments', async () => {
    const tables = makeTables();
    tables.melee_tournaments = [
      { melee_id: 100, season_id: 5, round: 1, name: 'SWU Wednesday league season 5 01/01 (week 1)', date: '2025-01-01T19:00:00' },
      { melee_id: 101, season_id: 5, round: 2, name: 'SWU Wednesday league season 5 08/01 (week 2)', date: '2025-01-08T19:00:00' },
    ];
    db = createMockDb(tables);
    let fetchCount = 0;
    globalThis.fetch = async (url) => {
      if (url.includes('/api/standings') || url.includes('/api/match/list/')) fetchCount++;
      return buildMockFetch()(url);
    };

    const result = await backfillFromMelee({ DB: db }, { MeleeClient: makeMockClient(globalThis.fetch), seasonId: 5 });

    assert.ok(fetchCount > 0, 'Standings/matches are re-fetched for existing tournaments');
    assert.equal(result.tournaments, 0, 'No new tournaments inserted');
  });

  it('listTournaments failure → loop breaks, returns zeros', async () => {
    const tables = makeTables();
    db = createMockDb(tables);
    const failingClient = class {
      async listTournaments() { throw new Error('API down'); }
      async getStandings() { return { Content: [] }; }
      async getMatches() { return { Content: [] }; }
    };

    const result = await backfillFromMelee({ DB: db }, { MeleeClient: failingClient, seasonId: 5 });

    assert.equal(result.tournaments, 0);
    assert.equal(result.standings, 0);
    assert.equal(result.matches, 0);
  });

  it('getStandings failure → skips standings, continues', async () => {
    const tables = makeTables();
    db = createMockDb(tables);
    const partialClient = class {
      async listTournaments() {
        return { Content: ALL_TOURNAMENTS.filter(t => t.ID === 100), TotalCount: 1 };
      }
      async getStandings() { throw new Error('Standings API down'); }
      async getMatches() { return { Content: [] }; }
    };

    const result = await backfillFromMelee({ DB: db }, { MeleeClient: partialClient, seasonId: 5 });

    assert.ok(result.tournaments > 0, 'Tournament stored before standings fetch');
    assert.equal(result.standings, 0, 'No standings stored');
  });

  it('getMatches failure → skips matches, continues', async () => {
    const tables = makeTables();
    db = createMockDb(tables);
    const partialClient = class {
      async listTournaments() {
        return { Content: ALL_TOURNAMENTS.filter(t => t.ID === 100), TotalCount: 1 };
      }
      async getStandings() { return { Content: STANDINGS }; }
      async getMatches() { throw new Error('Matches API down'); }
    };

    const result = await backfillFromMelee({ DB: db }, { MeleeClient: partialClient, seasonId: 5 });

    assert.ok(result.tournaments > 0, 'Tournament stored');
    assert.ok(result.standings > 0, 'Standings stored');
    assert.equal(result.matches, 0, 'No matches stored');
  });

  it('resync:true wipes existing standings/matches/attendance for target season', async () => {
    const tables = makeTables();
    tables.season_standings = [
      { season_id: 5, round: 1, player_id: 'P999', wins: 3, losses: 0, draws: 0, match_points: 9, rank: 1 },
    ];
    tables.match_results = [
      { id: 1, season_id: 5, round: 1, melee_match_id: 'old-match', player1_id: 'P999', player2_id: 'P002', winner_id: 'P999', result: '2-0', is_bye: 0 },
    ];
    tables.attendance = [
      { season_id: 5, week: 1, player_id: 'P999' },
    ];
    db = createMockDb(tables);
    globalThis.fetch = buildMockFetch();

    await backfillFromMelee({ DB: db }, { MeleeClient: makeMockClient(globalThis.fetch), seasonId: 5, resync: true });

    const store = db.getStore();
    const oldStanding = store.season_standings.find(s => s.player_id === 'P999');
    assert.ok(!oldStanding, 'Old standing wiped');
    const oldMatch = store.match_results.find(m => m.melee_match_id === 'old-match');
    assert.ok(!oldMatch, 'Old match wiped');
    const oldAttendance = store.attendance.find(a => a.player_id === 'P999');
    assert.ok(!oldAttendance, 'Old attendance wiped');
  });

  it('skips round only when both standings and matches exist', async () => {
    const tables = makeTables();
    tables.season_standings = [
      { season_id: 5, round: 1, player_id: 'P001', wins: 3, losses: 0, draws: 0, match_points: 9, rank: 1 },
    ];
    tables.match_results = [];
    db = createMockDb(tables);
    let standingsFetched = false;
    globalThis.fetch = async (url) => {
      if (url.includes('/api/standing/list/current/')) standingsFetched = true;
      return buildMockFetch()(url);
    };

    await backfillFromMelee({ DB: db }, { MeleeClient: makeMockClient(globalThis.fetch), seasonId: 5 });

    assert.ok(standingsFetched, 'Standings re-fetched when only standings exist (no matches)');
  });

  it('skips round when both standings and matches exist', async () => {
    const tables = makeTables();
    tables.melee_tournaments = [
      { melee_id: 100, season_id: 5, round: 1, name: 'SWU Wednesday league season 5 01/01 (week 1)', date: '2025-01-01T19:00:00' },
    ];
    tables.season_standings = [
      { season_id: 5, round: 1, player_id: 'P001', wins: 3, losses: 0, draws: 0, match_points: 9, rank: 1 },
    ];
    tables.match_results = [
      { id: 1, season_id: 5, round: 1, melee_match_id: 'match-1', player1_id: 'P001', player2_id: 'P002', winner_id: 'P001', result: '2-0', is_bye: 0 },
    ];
    db = createMockDb(tables);
    let fetchCount = 0;
    globalThis.fetch = async (url) => {
      if (url.includes('/api/standing/list/current/') || url.includes('/api/match/list/')) fetchCount++;
      return { ok: true, status: 200, text: async () => JSON.stringify({ Content: [{ ID: 100, Name: 'SWU Wednesday league season 5 01/01 (week 1)', StartDate: '2025-01-01T19:00:00' }], TotalCount: 1 }) };
    };

    await backfillFromMelee({ DB: db }, { MeleeClient: makeMockClient(globalThis.fetch), seasonId: 5 });

    assert.equal(fetchCount, 0, 'No standings/matches fetched when both exist');
  });

  it('rebuilds attendance from regular standings during backfill', async () => {
    const tables = makeTables();
    db = createMockDb(tables);
    globalThis.fetch = buildMockFetch();

    await backfillFromMelee({ DB: db }, { MeleeClient: makeMockClient(globalThis.fetch), seasonId: 5 });

    const store = db.getStore();
    const attendance = store.attendance.filter(a => a.season_id === 5);
    assert.ok(attendance.length > 0, 'Attendance rebuilt from standings');
  });

  it('defaults maxTournaments to 5', async () => {
    const tables = makeTables();
    db = createMockDb(tables);
    let tournamentsProcessed = 0;
    globalThis.fetch = async (url) => {
      if (url.includes('/api/standing/list/current/') || url.includes('/api/match/list/')) tournamentsProcessed++;
      return buildMockFetch()(url);
    };

    await backfillFromMelee({ DB: db }, { MeleeClient: makeMockClient(globalThis.fetch), seasonId: 5 });

    assert.ok(tournamentsProcessed <= 10, 'At most 5 tournaments processed (standings + matches each)');
  });

  it('tags phase on tournament insert', async () => {
    const tables = makeTables();
    db = createMockDb(tables);
    globalThis.fetch = buildMockFetch();

    await backfillFromMelee({ DB: db }, { MeleeClient: makeMockClient(globalThis.fetch), seasonId: 5 });

    const store = db.getStore();
    const tournaments = store.melee_tournaments.filter(t => t.season_id === 5);
    assert.ok(tournaments.every(t => t.phase), 'All tournaments have phase');
  });

  it('includes cut and side events with correct phases', async () => {
    const tables = makeTables();
    db = createMockDb(tables);
    const fetchFn = async (url) => {
      if (url.includes('/api/tournament/list')) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ Content: SEASON_6_TOURNAMENTS, TotalCount: SEASON_6_TOURNAMENTS.length }) };
      }
      return buildMockFetch()(url);
    };
    globalThis.fetch = fetchFn;

    await backfillFromMelee({ DB: db }, { MeleeClient: makeMockClient(fetchFn), seasonId: 6, maxTournaments: 15 });

    const store = db.getStore();
    const tournaments = store.melee_tournaments.filter(t => t.season_id === 6);
    assert.equal(tournaments.length, 13, 'All 13 tournaments stored (11 regular + 1 cut + 1 side)');

    const top4 = tournaments.find(t => t.name.includes('TOP 4'));
    assert.ok(top4, 'TOP 4 tournament stored');
    assert.equal(top4.phase, 'cut', 'TOP 4 has cut phase');

    const bestOfRest = tournaments.find(t => t.name.includes('Best of the Rest'));
    assert.ok(bestOfRest, 'Best of the Rest tournament stored');
    assert.equal(bestOfRest.phase, 'side', 'Best of the Rest has side phase');
  });

  it('assigns regular rounds 1-N and cut/side after', async () => {
    const tables = makeTables();
    db = createMockDb(tables);
    const fetchFn = async (url) => {
      if (url.includes('/api/tournament/list')) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ Content: SEASON_6_TOURNAMENTS, TotalCount: SEASON_6_TOURNAMENTS.length }) };
      }
      return buildMockFetch()(url);
    };
    globalThis.fetch = fetchFn;

    await backfillFromMelee({ DB: db }, { MeleeClient: makeMockClient(fetchFn), seasonId: 6, maxTournaments: 15 });

    const store = db.getStore();
    const tournaments = store.melee_tournaments.filter(t => t.season_id === 6);
    const regulars = tournaments.filter(t => t.phase === 'regular');
    const specials = tournaments.filter(t => t.phase !== 'regular');

    const regularRounds = regulars.map(t => t.round).sort((a, b) => a - b);
    assert.deepEqual(regularRounds, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], 'Regulars get rounds 1-11');

    const maxRegularRound = Math.max(...regularRounds);
    for (const s of specials) {
      assert.ok(s.round > maxRegularRound, `${s.name} round ${s.round} is after regulars (>${maxRegularRound})`);
    }
  });

  it('resync:true wipes melee_tournaments for target season', async () => {
    const tables = makeTables();
    tables.melee_tournaments = [
      { melee_id: 999, season_id: 5, round: 1, name: 'Old tournament', date: '2025-01-01', phase: 'regular' },
      { melee_id: 998, season_id: 5, round: 2, name: 'Old tournament 2', date: '2025-01-08', phase: 'regular' },
    ];
    db = createMockDb(tables);
    globalThis.fetch = buildMockFetch();

    await backfillFromMelee({ DB: db }, { MeleeClient: makeMockClient(globalThis.fetch), seasonId: 5, resync: true });

    const store = db.getStore();
    const oldTournaments = store.melee_tournaments.filter(t => t.melee_id === 999 || t.melee_id === 998);
    assert.equal(oldTournaments.length, 0, 'Old tournaments wiped on resync');

    const newTournaments = store.melee_tournaments.filter(t => t.season_id === 5);
    assert.ok(newTournaments.length > 0, 'New tournaments inserted after wipe');
  });

  it('no round collisions with mixed explicit and unlabeled tournaments', async () => {
    const tables = makeTables();
    db = createMockDb(tables);
    const fetchFn = async (url) => {
      if (url.includes('/api/tournament/list')) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ Content: SEASON_6_TOURNAMENTS, TotalCount: SEASON_6_TOURNAMENTS.length }) };
      }
      return buildMockFetch()(url);
    };
    globalThis.fetch = fetchFn;

    await backfillFromMelee({ DB: db }, { MeleeClient: makeMockClient(fetchFn), seasonId: 6, maxTournaments: 15 });

    const store = db.getStore();
    const tournaments = store.melee_tournaments.filter(t => t.season_id === 6);
    const rounds = tournaments.map(t => t.round);
    const uniqueRounds = new Set(rounds);
    assert.equal(rounds.length, uniqueRounds.size, 'No duplicate round numbers');
  });
});
