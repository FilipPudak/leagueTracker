import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMockDb } from '../helpers/mock-db.js';
import { basicTables } from '../helpers/fixtures.js';
import { syncFromMelee } from '../../src/triggers/syncFromMelee.js';
import { getSettings } from '../../src/db/queries.js';

function makeTables(overrides = {}) {
  const t = basicTables();
  if (overrides.settings) t.settings = overrides.settings;
  if (overrides.melee_tournaments) t.melee_tournaments = overrides.melee_tournaments;
  if (overrides.season_standings) t.season_standings = overrides.season_standings;
  if (overrides.match_results) t.match_results = overrides.match_results;
  return t;
}

function withSeasonStarted(tables) {
  const settings = tables.settings.map(s =>
    s.key === 'SEASON_STARTED' ? { ...s, value: 'TRUE' } : s
  );
  if (!settings.find(s => s.key === 'SEASON_STARTED')) {
    settings.push({ key: 'SEASON_STARTED', value: 'TRUE' });
  }
  return { ...tables, settings };
}

const TOURNAMENTS = [
  { ID: 100, Name: 'SWU Wednesday league season 6 01/01 (week 1)', StartDate: '2026-01-01T19:00:00' },
  { ID: 101, Name: 'SWU Wednesday league season 6 08/01 (week 2)', StartDate: '2026-01-08T19:00:00' },
  { ID: 102, Name: 'SWU Wednesday league season 6 15/01 (week 3)', StartDate: '2026-01-15T19:00:00' },
];

const STANDINGS = [
  { Rank: 1, Points: 9, MatchWins: 3, MatchDraws: 0, MatchLosses: 0, GameWins: 6, GameLosses: 1, Team: { Players: [{ Username: 'alice42', ID: 'g1' }] } },
  { Rank: 2, Points: 6, MatchWins: 2, MatchDraws: 0, MatchLosses: 1, GameWins: 4, GameLosses: 3, Team: { Players: [{ Username: 'bob55', ID: 'g2' }] } },
  { Rank: 3, Points: 3, MatchWins: 1, MatchDraws: 0, MatchLosses: 2, GameWins: 2, GameLosses: 4, Team: { Players: [{ Username: 'charlie99', ID: 'g3' }] } },
];

const MATCHES = [
  { ID: 500, Competitors: [
    { Team: { Players: [{ Username: 'alice42', ID: 'g1' }] }, GameWins: 2, GameByes: 0 },
    { Team: { Players: [{ Username: 'bob55', ID: 'g2' }] }, GameWins: 1, GameByes: 0 },
  ], WinnerId: 'g1', ByeReason: null },
  { ID: 501, Competitors: [
    { Team: { Players: [{ Username: 'alice42', ID: 'g1' }] }, GameWins: 2, GameByes: 0 },
    { Team: { Players: [{ Username: 'charlie99', ID: 'g3' }] }, GameWins: 0, GameByes: 0 },
  ], WinnerId: 'g1', ByeReason: null },
  { ID: 502, Competitors: [
    { Team: { Players: [{ Username: 'bob55', ID: 'g2' }] }, GameWins: 2, GameByes: 0 },
    { Team: { Players: [{ Username: 'charlie99', ID: 'g3' }] }, GameWins: 1, GameByes: 0 },
  ], WinnerId: 'g2', ByeReason: null },
];

function buildMockFetch(overrides = {}) {
  const tournaments = overrides.tournaments || TOURNAMENTS;
  const standings = overrides.standings || STANDINGS;
  const matches = overrides.matches || MATCHES;
  const calls = [];

  const mockFetch = async (url) => {
    calls.push(url);
    if (url.includes('/api/tournament/list')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ Content: tournaments, TotalCount: tournaments.length }) };
    }
    if (url.includes('/api/standings')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ Content: standings }) };
    }
    if (url.includes('/api/match/list/')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ Content: matches }) };
    }
    return { ok: false, status: 404, text: async () => 'Not found' };
  };

  return { mockFetch, calls };
}

function makeMockClient(fetchFn) {
  return class {
    async listTournaments() {
      const r = await fetchFn('https://melee.gg/api/tournament/list');
      return JSON.parse(await r.text());
    }
    async getStandings() {
      const r = await fetchFn('https://melee.gg/api/standings');
      return JSON.parse(await r.text());
    }
    async getMatches() {
      const r = await fetchFn('https://melee.gg/api/match/list/1');
      return JSON.parse(await r.text());
    }
  };
}

describe('triggers/syncFromMelee', () => {
  let db;
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('skips when SEASON_STARTED is FALSE', async () => {
    const settings = basicTables().settings
      .filter(s => s.key !== 'SEASON_STARTED')
      .concat([{ key: 'SEASON_STARTED', value: 'FALSE' }]);
    db = createMockDb(makeTables({ settings }));

    let fetchCount = 0;
    globalThis.fetch = async () => { fetchCount++; return { ok: false }; };

    await syncFromMelee({ DB: db }, {});
    assert.equal(fetchCount, 0);
  });

  it('skips when SEASON_STARTED is missing', async () => {
    const settings = basicTables().settings.filter(s => s.key !== 'SEASON_STARTED');
    db = createMockDb(makeTables({ settings }));

    let fetchCount = 0;
    globalThis.fetch = async () => { fetchCount++; return { ok: false }; };

    await syncFromMelee({ DB: db }, {});
    assert.equal(fetchCount, 0);
  });

  it('fetches tournaments and stores in melee_tournaments', async () => {
    db = createMockDb(withSeasonStarted(makeTables()));
    const { mockFetch } = buildMockFetch();
    globalThis.fetch = mockFetch;

    await syncFromMelee({ DB: db }, { MeleeClient: makeMockClient(mockFetch) });

    const store = db.getStore();
    assert.ok(store.melee_tournaments.length > 0);
    assert.equal(store.melee_tournaments[0].melee_id, 100);
    assert.equal(store.melee_tournaments[0].season_id, 6);
    assert.equal(store.melee_tournaments[0].round, 1);
  });

  it('filters out non-league tournaments', async () => {
    const mixed = [
      { ID: 100, Name: 'SWU Wednesday league season 6 01/01 (week 1)', StartDate: '2026-01-01T19:00:00' },
      { ID: 200, Name: 'SWU TWI Store Championship', StartDate: '2026-01-02T19:00:00' },
      { ID: 201, Name: 'SWU Wednesday league season 6 TOP 8 08/01', StartDate: '2026-01-08T19:00:00' },
    ];
    db = createMockDb(withSeasonStarted(makeTables()));
    const { mockFetch } = buildMockFetch({ tournaments: mixed });
    globalThis.fetch = mockFetch;

    await syncFromMelee({ DB: db }, { MeleeClient: makeMockClient(mockFetch) });

    const store = db.getStore();
    const ids = store.melee_tournaments.map(t => t.melee_id);
    assert.ok(ids.includes(100), 'league tournament kept');
    assert.ok(!ids.includes(200), 'store championship excluded');
    assert.ok(!ids.includes(201), 'TOP 8 excluded');
  });

  it('stores standings in season_standings', async () => {
    db = createMockDb(withSeasonStarted(makeTables()));
    const { mockFetch } = buildMockFetch({ tournaments: TOURNAMENTS.slice(0, 1) });
    globalThis.fetch = mockFetch;

    await syncFromMelee({ DB: db }, { MeleeClient: makeMockClient(mockFetch) });

    const store = db.getStore();
    assert.ok(store.season_standings.length > 0);
    const alice = store.season_standings.find(s => s.player_id === 'P001');
    assert.ok(alice);
    assert.equal(alice.wins, 3);
    assert.equal(alice.rank, 1);
  });

  it('stores matches in match_results', async () => {
    db = createMockDb(withSeasonStarted(makeTables()));
    const { mockFetch } = buildMockFetch({ tournaments: TOURNAMENTS.slice(0, 1) });
    globalThis.fetch = mockFetch;

    await syncFromMelee({ DB: db }, { MeleeClient: makeMockClient(mockFetch) });

    const store = db.getStore();
    assert.ok(store.match_results.length > 0);
    const aliceVsBob = store.match_results.find(m =>
      (m.player1_id === 'P001' && m.player2_id === 'P002') ||
      (m.player1_id === 'P002' && m.player2_id === 'P001')
    );
    assert.ok(aliceVsBob);
    assert.equal(aliceVsBob.winner_id, 'P001');
  });

  it('records attendance for players in standings', async () => {
    db = createMockDb(withSeasonStarted(makeTables()));
    const { mockFetch } = buildMockFetch({ tournaments: TOURNAMENTS.slice(0, 1) });
    globalThis.fetch = mockFetch;

    await syncFromMelee({ DB: db }, { MeleeClient: makeMockClient(mockFetch) });

    const store = db.getStore();
    const week1 = store.attendance.filter(a => a.season_id === 6 && a.week === 1);
    assert.ok(week1.length >= 3);
  });

  it('opens voting on first run (VOTING_OPEN=FALSE → TRUE)', async () => {
    const tables = withSeasonStarted(makeTables());
    tables.settings = tables.settings.map(s =>
      s.key === 'VOTING_OPEN' ? { ...s, value: 'FALSE' } : s
    );
    db = createMockDb(tables);
    const { mockFetch } = buildMockFetch({ tournaments: TOURNAMENTS.slice(0, 1) });
    globalThis.fetch = mockFetch;

    await syncFromMelee({ DB: db }, { MeleeClient: makeMockClient(mockFetch) });

    const settings = await getSettings(db);
    assert.equal(settings.VOTING_OPEN, 'TRUE');
    assert.equal(settings.CURRENT_WEEK, 'Week 3', 'Week not advanced on first run');
  });

  it('advances week on subsequent runs', async () => {
    const tables = withSeasonStarted(makeTables());
    tables.settings = tables.settings.map(s =>
      s.key === 'CURRENT_WEEK' ? { ...s, value: 'Week 2' } : s
    );
    db = createMockDb(tables);
    const { mockFetch } = buildMockFetch();
    globalThis.fetch = mockFetch;

    await syncFromMelee({ DB: db }, { MeleeClient: makeMockClient(mockFetch) });

    const settings = await getSettings(db);
    assert.equal(settings.CURRENT_WEEK, 'Week 3');
  });

  it('ends season when nextWeek > season length', async () => {
    const tables = withSeasonStarted(makeTables());
    tables.settings = tables.settings.map(s =>
      s.key === 'CURRENT_WEEK' ? { ...s, value: 'Week 11' } : s
    );
    db = createMockDb(tables);
    const { mockFetch } = buildMockFetch();
    globalThis.fetch = mockFetch;

    await syncFromMelee({ DB: db }, { MeleeClient: makeMockClient(mockFetch) });

    const settings = await getSettings(db);
    assert.equal(settings.CURRENT_WEEK, 'Season Ended');
    assert.equal(settings.VOTING_OPEN, 'FALSE');
    assert.equal(settings.SEASON_STARTED, 'FALSE');
  });

  it('refreshes awards after sync', async () => {
    const tables = withSeasonStarted(makeTables());
    tables.awards = [];
    db = createMockDb(tables);
    const { mockFetch } = buildMockFetch({ tournaments: TOURNAMENTS.slice(0, 1) });
    globalThis.fetch = mockFetch;

    await syncFromMelee({ DB: db }, { MeleeClient: makeMockClient(mockFetch) });

    const store = db.getStore();
    assert.ok(store.awards.filter(a => a.award_name === 'Galactic Schemer').length > 0);
    assert.ok(store.awards.filter(a => a.award_name === 'Galactic Ambassador').length > 0);
  });

  it('re-activates inactive players who attend, no deactivation mid-season', async () => {
    const tables = withSeasonStarted(makeTables());
    db = createMockDb(tables);
    db.getStore().players.find(p => p.id === 'P005').active = 0;

    const { mockFetch } = buildMockFetch({ tournaments: TOURNAMENTS.slice(0, 1) });
    globalThis.fetch = mockFetch;

    await syncFromMelee({ DB: db }, { MeleeClient: makeMockClient(mockFetch) });

    const players = db.getStore().players;
    assert.equal(players.find(p => p.id === 'P001').active, 1, 'Alice active (attended)');
    assert.equal(players.find(p => p.id === 'P005').active, 0, 'Eve stays inactive (did not attend, but no mid-season deactivation)');
  });

  it('deactivates absent players at season end', async () => {
    const tables = withSeasonStarted(makeTables());
    tables.settings = tables.settings.map(s =>
      s.key === 'CURRENT_WEEK' ? { ...s, value: 'Week 3' } : s
    );
    db = createMockDb(tables);
    db.getStore().players.find(p => p.id === 'P005').active = 1;

    const { mockFetch } = buildMockFetch({ tournaments: TOURNAMENTS.slice(0, 1) });
    globalThis.fetch = mockFetch;

    await syncFromMelee({ DB: db }, { MeleeClient: makeMockClient(mockFetch) });

    const players = db.getStore().players;
    assert.equal(players.find(p => p.id === 'P001').active, 1, 'Alice active (attended)');
    assert.equal(players.find(p => p.id === 'P005').active, 0, 'Eve deactivated at season end');
  });

  it('listTournaments failure → loop breaks, no crash', async () => {
    db = createMockDb(withSeasonStarted(makeTables()));
    const failingClient = class {
      async listTournaments() { throw new Error('API down'); }
      async getStandings() { return { Content: [] }; }
      async getMatches() { return { Content: [] }; }
    };

    await syncFromMelee({ DB: db }, { MeleeClient: failingClient });

    const store = db.getStore();
    assert.equal(store.melee_tournaments.length, 0, 'No tournaments stored');
  });

  it('getStandings failure → skips tournament, continues', async () => {
    db = createMockDb(withSeasonStarted(makeTables()));
    const partialClient = class {
      async listTournaments() {
        return { Content: [TOURNAMENTS[0]], TotalCount: 1 };
      }
      async getStandings() { throw new Error('Standings API down'); }
      async getMatches() { return { Content: [] }; }
    };

    await syncFromMelee({ DB: db }, { MeleeClient: partialClient });

    const store = db.getStore();
    assert.equal(store.season_standings.length, 0, 'No standings stored');
    assert.equal(store.match_results.length, 0, 'Matches skipped too (continue skips entire tournament)');
  });

  it('getMatches failure → skips matches, continues', async () => {
    db = createMockDb(withSeasonStarted(makeTables()));
    const partialClient = class {
      async listTournaments() {
        return { Content: [TOURNAMENTS[0]], TotalCount: 1 };
      }
      async getStandings() {
        return { Content: STANDINGS };
      }
      async getMatches() { throw new Error('Matches API down'); }
    };

    await syncFromMelee({ DB: db }, { MeleeClient: partialClient });

    const store = db.getStore();
    assert.ok(store.season_standings.length > 0, 'Standings still stored');
    assert.equal(store.match_results.length, 0, 'No matches stored');
  });
});
