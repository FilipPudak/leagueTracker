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
    if (url.includes('/api/standing/list/current/')) {
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
      { ID: 202, Name: 'SWU Wednesday league season 6 clone 15/01', StartDate: '2026-01-15T19:00:00' },
    ];
    db = createMockDb(withSeasonStarted(makeTables()));
    const { mockFetch } = buildMockFetch({ tournaments: mixed });
    globalThis.fetch = mockFetch;

    await syncFromMelee({ DB: db }, { MeleeClient: makeMockClient(mockFetch) });

    const store = db.getStore();
    const ids = store.melee_tournaments.map(t => t.melee_id);
    assert.ok(ids.includes(100), 'league tournament kept');
    assert.ok(!ids.includes(200), 'store championship excluded');
    assert.ok(ids.includes(201), 'TOP 8 included');
    assert.ok(!ids.includes(202), 'clone excluded');
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

    const lateTime = '2026-07-01T20:15:00Z';
    await syncFromMelee({ DB: db }, { MeleeClient: makeMockClient(mockFetch), now: lateTime });

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

    const lateTime = '2026-07-01T20:15:00Z';
    await syncFromMelee({ DB: db }, { MeleeClient: makeMockClient(mockFetch), now: lateTime });

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

    const lateTime = '2026-07-01T20:15:00Z';
    await syncFromMelee({ DB: db }, { MeleeClient: makeMockClient(mockFetch), now: lateTime });

    const settings = await getSettings(db);
    assert.equal(settings.CURRENT_WEEK, 'Season Ended');
    assert.equal(settings.VOTING_OPEN, 'FALSE');
    assert.equal(settings.SEASON_STARTED, 'FALSE');
  });

  it('advances when few tournaments exist on Melee yet', async () => {
    const tables = withSeasonStarted(makeTables());
    tables.settings = tables.settings.map(s =>
      s.key === 'CURRENT_WEEK' ? { ...s, value: 'Week 2' } : s
    );
    db = createMockDb(tables);
    const { mockFetch } = buildMockFetch({ tournaments: TOURNAMENTS.slice(0, 1) });
    globalThis.fetch = mockFetch;

    const lateTime = '2026-07-01T20:15:00Z';
    await syncFromMelee({ DB: db }, { MeleeClient: makeMockClient(mockFetch), now: lateTime });

    const settings = await getSettings(db);
    assert.equal(settings.CURRENT_WEEK, 'Week 3', 'must advance, not end — SEASON_LENGTH=11 floors the dynamic count');
    assert.equal(settings.SEASON_STARTED, 'TRUE');
    assert.equal(settings.VOTING_OPEN, 'TRUE');
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

  it('re-activates inactive players who attend', async () => {
    const tables = withSeasonStarted(makeTables());
    db = createMockDb(tables);
    db.getStore().players.find(p => p.id === 'P005').active = 0;

    const { mockFetch } = buildMockFetch({ tournaments: TOURNAMENTS.slice(0, 1) });
    globalThis.fetch = mockFetch;

    await syncFromMelee({ DB: db }, { MeleeClient: makeMockClient(mockFetch) });

    const players = db.getStore().players;
    assert.equal(players.find(p => p.id === 'P001').active, 1, 'Alice active (attended)');
    assert.equal(players.find(p => p.id === 'P005').active, 0, 'Eve stays inactive (did not attend)');
  });

  it('listTournaments failure → aborts before advance, no crash, no writes', async () => {
    const tables = withSeasonStarted(makeTables());
    tables.settings = tables.settings.map(s =>
      s.key === 'CURRENT_WEEK' ? { ...s, value: 'Week 2' } : s
    );
    db = createMockDb(tables);
    const failingClient = class {
      async listTournaments() { throw new Error('API down'); }
      async getStandings() { return { Content: [] }; }
      async getMatches() { return { Content: [] }; }
    };

    const lateTime = '2026-07-01T20:15:00Z';
    const result = await syncFromMelee({ DB: db }, { MeleeClient: failingClient, now: lateTime });

    assert.equal(result.status, 'fetch-failed');
    const store = db.getStore();
    assert.equal(store.melee_tournaments.length, 0, 'No tournaments stored');
    const settings = await getSettings(db);
    assert.equal(settings.CURRENT_WEEK, 'Week 2', 'Week NOT advanced on list-fetch failure');
    assert.ok(!settings.LAST_ADVANCED, 'LAST_ADVANCED not stamped → backup cron can retry');
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

  it('syncs data only when SEASON_PAUSED=TRUE, no advance/open/close', async () => {
    const tables = withSeasonStarted(makeTables());
    tables.settings = tables.settings.map(s =>
      s.key === 'VOTING_OPEN' ? { ...s, value: 'TRUE' } : s
    ).map(s =>
      s.key === 'CURRENT_WEEK' ? { ...s, value: 'Week 1' } : s
    );
    tables.settings.push({ key: 'SEASON_PAUSED', value: 'TRUE' });
    db = createMockDb(tables);
    const { mockFetch } = buildMockFetch({ tournaments: TOURNAMENTS.slice(0, 1) });
    globalThis.fetch = mockFetch;

    await syncFromMelee({ DB: db }, { MeleeClient: makeMockClient(mockFetch) });

    const settings = await getSettings(db);
    assert.equal(settings.CURRENT_WEEK, 'Week 1', 'Week not advanced when paused');
    assert.equal(settings.VOTING_OPEN, 'TRUE', 'Voting not opened/closed when paused');
    const store = db.getStore();
    assert.ok(store.season_standings.length > 0, 'Data still synced');
  });

  it('does not advance when shouldAdvance gate rejects (too early)', async () => {
    const tables = withSeasonStarted(makeTables());
    tables.settings = tables.settings.map(s =>
      s.key === 'CURRENT_WEEK' ? { ...s, value: 'Week 2' } : s
    );
    db = createMockDb(tables);
    const { mockFetch } = buildMockFetch({ tournaments: TOURNAMENTS.slice(0, 1) });
    globalThis.fetch = mockFetch;

    const earlyTime = '2026-07-01T19:00:00Z';
    await syncFromMelee({ DB: db }, { MeleeClient: makeMockClient(mockFetch), now: earlyTime });

    const settings = await getSettings(db);
    assert.equal(settings.CURRENT_WEEK, 'Week 2', 'Week not advanced before 22:10 Stockholm');
  });

  it('does not advance when LAST_ADVANCED matches today', async () => {
    const tables = withSeasonStarted(makeTables());
    tables.settings = tables.settings.map(s =>
      s.key === 'CURRENT_WEEK' ? { ...s, value: 'Week 2' } : s
    );
    tables.settings.push({ key: 'LAST_ADVANCED', value: '2026-07-01' });
    db = createMockDb(tables);
    const { mockFetch } = buildMockFetch({ tournaments: TOURNAMENTS.slice(0, 1) });
    globalThis.fetch = mockFetch;

    const lateTime = '2026-07-01T20:15:00Z';
    await syncFromMelee({ DB: db }, { MeleeClient: makeMockClient(mockFetch), now: lateTime });

    const settings = await getSettings(db);
    assert.equal(settings.CURRENT_WEEK, 'Week 2', 'Week not advanced when LAST_ADVANCED matches today');
  });

  describe('award lifecycle (fully-synced season)', () => {
    function fullySyncedTables() {
      const tables = withSeasonStarted(makeTables());
      tables.melee_tournaments = [
        { melee_id: 100, season_id: 6, round: 1, name: 'SWU Wednesday league season 6 01/07 (week 1)', date: '2026-07-01', phase: 'regular' },
        { melee_id: 101, season_id: 6, round: 2, name: 'SWU Wednesday league season 6 08/07 (week 2)', date: '2026-07-08', phase: 'regular' },
        { melee_id: 102, season_id: 6, round: 3, name: 'SWU Wednesday league season 6 15/07 (week 3)', date: '2026-07-15', phase: 'regular' },
        { melee_id: 50, season_id: 5, round: 1, name: 'SWU Wednesday league season 5 01/01 (week 1)', date: '2026-01-01', phase: 'regular' },
      ];
      tables.season_standings = [
        { season_id: 6, round: 1, player_id: 'P001', wins: 0, losses: 3, draws: 0, match_points: 10, rank: 1 },
        { season_id: 6, round: 1, player_id: 'P003', wins: 1, losses: 2, draws: 0, match_points: 5, rank: 2 },
        { season_id: 6, round: 1, player_id: 'P002', wins: 2, losses: 1, draws: 0, match_points: 0, rank: 3 },
        { season_id: 6, round: 2, player_id: 'P001', wins: 0, losses: 3, draws: 0, match_points: 10, rank: 1 },
        { season_id: 6, round: 2, player_id: 'P003', wins: 1, losses: 2, draws: 0, match_points: 5, rank: 2 },
        { season_id: 6, round: 2, player_id: 'P002', wins: 2, losses: 1, draws: 0, match_points: 0, rank: 3 },
        { season_id: 6, round: 3, player_id: 'P002', wins: 3, losses: 0, draws: 0, match_points: 12, rank: 1 },
        { season_id: 6, round: 3, player_id: 'P003', wins: 0, losses: 3, draws: 0, match_points: 0, rank: 2 },
        { season_id: 6, round: 3, player_id: 'P001', wins: 0, losses: 3, draws: 0, match_points: 0, rank: 3 },
        { season_id: 5, round: 1, player_id: 'P001', wins: 3, losses: 0, draws: 0, match_points: 9, rank: 1 },
        { season_id: 5, round: 1, player_id: 'P002', wins: 2, losses: 1, draws: 0, match_points: 6, rank: 2 },
        { season_id: 5, round: 1, player_id: 'P003', wins: 1, losses: 2, draws: 0, match_points: 3, rank: 3 },
      ];
      tables.match_results = [
        { season_id: 6, round: 1, melee_match_id: 'bh1', player1_id: 'P004', player2_id: 'P001', winner_id: 'P004', result: '2-1', is_bye: 0 },
        { season_id: 6, round: 2, melee_match_id: 'm2', player1_id: 'P001', player2_id: 'P002', winner_id: 'P001', result: '2-0', is_bye: 0 },
        { season_id: 6, round: 3, melee_match_id: 'm3', player1_id: 'P003', player2_id: 'P001', winner_id: 'P003', result: '2-1', is_bye: 0 },
      ];
      return tables;
    }

    function emptyListClient() {
      return class {
        async listTournaments() { return { Content: [], TotalCount: 0 }; }
        async getStandings() { return { Content: [] }; }
        async getMatches() { return { Content: [] }; }
      };
    }

    it('writes A New Hope climbers, Bounty Hunter, and refreshed Ruler podiums', async () => {
      db = createMockDb(fullySyncedTables());
      const result = await syncFromMelee(
        { DB: db },
        { MeleeClient: emptyListClient(), now: '2026-07-15T20:15:00Z' }
      );
      assert.equal(result.status, 'advanced');
      assert.equal(result.week, 4);

      const awards = db.getStore().awards;
      const newHope = awards.filter(a => a.award_name === 'A New Hope' && a.season_id === 6);
      assert.ok(newHope.length > 0, 'A New Hope podium written (climbers exist)');
      const nhIds = newHope.map(a => a.player_id);
      assert.ok(nhIds.includes('P002') && nhIds.includes('P003'), 'mid→final climbers P002/P003 recognized');
      assert.ok(!nhIds.includes('P001'), 'P001 fell (mid 1 → final 3), not a climber');

      const bh = awards.find(a => a.award_name === 'Bounty Hunter' && a.season_id === 6);
      assert.ok(bh, 'Bounty Hunter podium written');
      assert.equal(bh.player_id, 'P004', 'P004 beat last season top-4 member P001');
      assert.equal(bh.score, 1);

      const ruler = awards.filter(a => a.award_name === 'Galactic Ruler' && a.season_id === 6).sort((a, b) => b.score - a.score);
      assert.equal(ruler[0].player_id, 'P002', 'season-table best-X winner takes Ruler');
      assert.equal(ruler[0].score, 21);
    });

    it('writes Galactic Champion when the season ends after a cut event', async () => {
      const tables = fullySyncedTables();
      tables.settings = tables.settings.map(s =>
        s.key === 'CURRENT_WEEK' ? { ...s, value: 'Week 11' } : s
      );
      tables.melee_tournaments.push(
        { melee_id: 200, season_id: 6, round: 12, name: 'SWU Wednesday league season 6 Top 8', date: '2026-09-09', phase: 'cut' }
      );
      tables.season_standings.push(
        { season_id: 6, round: 12, player_id: 'P005', wins: 4, losses: 1, draws: 0, match_points: 12, rank: 1 },
        { season_id: 6, round: 12, player_id: 'P002', wins: 3, losses: 2, draws: 0, match_points: 9, rank: 2 }
      );
      db = createMockDb(tables);
      const result = await syncFromMelee(
        { DB: db },
        { MeleeClient: emptyListClient(), now: '2026-09-09T20:15:00Z' }
      );
      assert.equal(result.status, 'season-ended');
      const champion = db.getStore().awards.find(a => a.award_name === 'Galactic Champion' && a.season_id === 6);
      assert.ok(champion, 'Champion award materialized at close');
      assert.equal(champion.player_id, 'P005');
      const settings = await getSettings(db);
      assert.equal(settings.CURRENT_WEEK, 'Season Ended');
    });

    it('race guard skips advance when LAST_ADVANCED changed mid-run', async () => {
      const tables = fullySyncedTables();
      tables.settings = tables.settings.map(s =>
        s.key === 'CURRENT_WEEK' ? { ...s, value: 'Week 2' } : s
      );
      db = createMockDb(tables);
      const store = db.getStore();
      let stamped = false;

      const racingClient = class {
        async listTournaments() {
          if (!stamped) {
            stamped = true;
            store.settings.push({ key: 'LAST_ADVANCED', value: '2026-07-15' });
          }
          return { Content: [], TotalCount: 0 };
        }
        async getStandings() { return { Content: [] }; }
        async getMatches() { return { Content: [] }; }
      };

      const result = await syncFromMelee({ DB: db }, { MeleeClient: racingClient, now: '2026-07-15T20:15:00Z' });
      assert.equal(result.status, 'synced-no-advance');
      assert.equal(result.reason, 'race-guard');
      const settings = await getSettings(db);
      assert.equal(settings.CURRENT_WEEK, 'Week 2', 'stale run must not clobber the concurrent advance');
    });
  });

  it('auto-creates unknown melee players from standings and matches (invariant 4)', async () => {
    db = createMockDb(withSeasonStarted(makeTables()));
    const ghostStandings = [
      { Rank: 1, Points: 9, MatchWins: 3, MatchDraws: 0, MatchLosses: 0, Team: { Players: [{ Username: 'alice42' }] } },
      { Rank: 2, Points: 6, MatchWins: 2, MatchDraws: 0, MatchLosses: 1, Team: { Players: [{ Username: 'ghost_player', DisplayName: 'Ghost Display' }] } },
    ];
    const ghostMatches = [
      { ID: 900, Competitors: [
        { Team: { Players: [{ Username: 'ghost_player', DisplayName: 'Ghost Display' }] }, GameWins: 2 },
        { Team: { Players: [{ Username: 'nobody_here' }] }, GameWins: 0 },
      ], ByeReason: null },
    ];
    const { mockFetch } = buildMockFetch({ tournaments: TOURNAMENTS.slice(0, 1), standings: ghostStandings, matches: ghostMatches });
    globalThis.fetch = mockFetch;

    const result = await syncFromMelee({ DB: db }, { MeleeClient: makeMockClient(mockFetch), now: '2026-07-01T15:00:00Z' });

    assert.equal(result.status, 'synced-no-advance', 'gate not met at pinned afternoon time');
    const store = db.getStore();
    const ghost = store.players.find(p => p.melee_name === 'ghost_player');
    const nobody = store.players.find(p => p.melee_name === 'nobody_here');
    assert.ok(ghost, 'ghost_player auto-created');
    assert.equal(ghost.name, 'Ghost Display', 'display name preferred over username');
    assert.equal(ghost.active, 1);
    assert.ok(nobody, 'nobody_here auto-created from match');
    assert.equal(nobody.name, 'nobody_here', 'username fallback when no display name');
    assert.ok(store.season_standings.every(r => r.player_id), 'no null-player standings rows');
    assert.equal(store.season_standings.length, 2, 'roster-matched and auto-created standings stored');
    assert.equal(store.season_standings.find(s => s.rank === 2).player_id, ghost.id);
    assert.equal(store.match_results.length, 1, 'match between auto-created players stored');
    assert.equal(store.match_results[0].winner_id, ghost.id);
    const week1 = store.attendance.filter(a => a.season_id === 6 && a.week === 1);
    assert.ok(week1.some(a => a.player_id === ghost.id), 'auto-created player gets attendance');
  });

  it('re-activates a returning player who attends', async () => {
    db = createMockDb(withSeasonStarted(makeTables()));
    db.getStore().players.find(p => p.id === 'P002').active = 0;
    const { mockFetch } = buildMockFetch({ tournaments: TOURNAMENTS.slice(0, 1) });
    globalThis.fetch = mockFetch;

    await syncFromMelee({ DB: db }, { MeleeClient: makeMockClient(mockFetch) });

    assert.equal(db.getStore().players.find(p => p.id === 'P002').active, 1, 'bob55 attended → reactivated');
  });
});
