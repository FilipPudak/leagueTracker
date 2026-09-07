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
    if (url.includes('/api/standings')) {
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

  it('skips already-synced tournaments', async () => {
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

    await backfillFromMelee({ DB: db }, { MeleeClient: makeMockClient(globalThis.fetch), seasonId: 5 });

    assert.equal(fetchCount, 0, 'No API calls for already-synced tournaments');
  });
});
