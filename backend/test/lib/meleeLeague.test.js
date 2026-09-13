import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { classifyPhase, isLeagueTournament, extractSeasonAndRound, sortRoundsDeterministic, buildWeekMap, createPlayerFinder, fetchLeagueTournaments } from '../../src/lib/meleeLeague.js';
import { createMockDb } from '../helpers/mock-db.js';
import { basicTables } from '../helpers/fixtures.js';

describe('meleeLeague', () => {
  describe('classifyPhase', () => {
    it('returns regular for date-based names', () => {
      assert.equal(classifyPhase('SWU Wednesday league season 6 15/7 (week 8)'), 'regular');
    });

    it('returns cut for Top 8', () => {
      assert.equal(classifyPhase('SWU Wednesday league season 6 TOP 8'), 'cut');
    });

    it('returns cut for Top 4', () => {
      assert.equal(classifyPhase('SWU Wednesday league season 6 Top 4'), 'cut');
    });

    it('returns cut for Playoff', () => {
      assert.equal(classifyPhase('SWU Wednesday league season 6 Playoff'), 'cut');
    });

    it('returns cut for Championship', () => {
      assert.equal(classifyPhase('SWU Wednesday league season 6 Championship'), 'cut');
    });

    it('returns side for Best of the Rest', () => {
      assert.equal(classifyPhase('SWU Wednesday league season 6 Best of the Rest'), 'side');
    });

    it('returns side for finale', () => {
      assert.equal(classifyPhase('SWU Wednesday league season 6 finale'), 'side');
    });
  });

  describe('isLeagueTournament', () => {
    it('accepts standard league name', () => {
      assert.ok(isLeagueTournament('SWU Wednesday league season 6 15/7 (week 8)'));
    });

    it('rejects prerelease', () => {
      assert.ok(!isLeagueTournament('SWU Wednesday league season 6 prerelease'));
    });

    it('rejects draft', () => {
      assert.ok(!isLeagueTournament('SWU Wednesday league season 6 draft'));
    });

    it('rejects clone', () => {
      assert.ok(!isLeagueTournament('SWU Wednesday league season 6 clone'));
    });

    it('rejects budget draft', () => {
      assert.ok(!isLeagueTournament('SWU Wednesday league season 6 budget draft'));
    });

    it('rejects non-league name', () => {
      assert.ok(!isLeagueTournament('Random tournament'));
    });
  });

  describe('extractSeasonAndRound', () => {
    it('extracts season and week', () => {
      const result = extractSeasonAndRound('SWU Wednesday league season 6 15/7 (week 8)');
      assert.deepEqual(result, { seasonNum: 6, week: 8 });
    });

    it('extracts season without week', () => {
      const result = extractSeasonAndRound('SWU Wednesday league season 6 TOP 8');
      assert.deepEqual(result, { seasonNum: 6, week: null });
    });

    it('returns null for non-league name', () => {
      assert.equal(extractSeasonAndRound('Random tournament'), null);
    });

    it('defaults to season 1 when no season number', () => {
      const result = extractSeasonAndRound('SWU Wednesday league 15/7');
      assert.deepEqual(result, { seasonNum: null, week: null });
    });
  });

  describe('sortRoundsDeterministic', () => {
    it('sorts by date first', () => {
      const tournaments = [
        { ID: 2, Name: 'B', StartDate: '2026-07-01' },
        { ID: 1, Name: 'A', StartDate: '2026-06-15' },
      ];
      const sorted = sortRoundsDeterministic(tournaments);
      assert.equal(sorted[0].ID, 1);
      assert.equal(sorted[1].ID, 2);
    });

    it('sorts cut before regular when same date', () => {
      const tournaments = [
        { ID: 1, Name: 'SWU Wednesday league season 6 15/7', StartDate: '2026-07-15' },
        { ID: 2, Name: 'SWU Wednesday league season 6 TOP 8', StartDate: '2026-07-15' },
      ];
      const sorted = sortRoundsDeterministic(tournaments);
      assert.equal(sorted[0].ID, 2);
      assert.equal(sorted[1].ID, 1);
    });

    it('sorts by melee_id as final tiebreaker', () => {
      const tournaments = [
        { ID: 2, Name: 'SWU Wednesday league season 6 15/7', StartDate: '2026-07-15' },
        { ID: 1, Name: 'SWU Wednesday league season 6 15/7', StartDate: '2026-07-15' },
      ];
      const sorted = sortRoundsDeterministic(tournaments);
      assert.equal(sorted[0].ID, 1);
      assert.equal(sorted[1].ID, 2);
    });
  });

  describe('buildWeekMap', () => {
    it('assigns sequential rounds by date order', () => {
      const tournaments = [
        { ID: 100, Name: 'SWU Wednesday league season 6 15/7', StartDate: '2026-07-15', phase: 'regular' },
        { ID: 101, Name: 'SWU Wednesday league season 6 22/7', StartDate: '2026-07-22', phase: 'regular' },
      ];
      const weekMap = buildWeekMap(tournaments);
      assert.equal(weekMap.size, 2);
      assert.equal(weekMap.get(100).round, 1);
      assert.equal(weekMap.get(101).round, 2);
    });

    it('assigns cut/side events after regulars', () => {
      const tournaments = [
        { ID: 100, Name: 'SWU Wednesday league season 6 15/7', StartDate: '2026-07-15', phase: 'regular' },
        { ID: 101, Name: 'SWU Wednesday league season 6 TOP 8', StartDate: '2026-07-22', phase: 'cut' },
        { ID: 102, Name: 'SWU Wednesday league season 6 Best of the Rest', StartDate: '2026-07-22', phase: 'side' },
      ];
      const weekMap = buildWeekMap(tournaments);
      assert.equal(weekMap.get(100).round, 1);
      assert.equal(weekMap.get(101).round, 2);
      assert.equal(weekMap.get(102).round, 3);
    });

    it('preserves existing round numbers from existingRoundMap', () => {
      const tournaments = [
        { ID: 100, Name: 'SWU Wednesday league season 6 15/7', StartDate: '2026-07-15', phase: 'regular' },
        { ID: 101, Name: 'SWU Wednesday league season 6 22/7', StartDate: '2026-07-22', phase: 'regular' },
      ];
      const existingRoundMap = new Map([[100, 5]]);
      const weekMap = buildWeekMap(tournaments, existingRoundMap);
      assert.equal(weekMap.get(100).round, 5);
      assert.equal(weekMap.get(101).round, 1);
    });

    it('includes phase in map entries', () => {
      const tournaments = [
        { ID: 100, Name: 'SWU Wednesday league season 6 TOP 8', phase: 'cut' },
      ];
      const weekMap = buildWeekMap(tournaments);
      assert.equal(weekMap.get(100).phase, 'cut');
    });
  });

  describe('createPlayerFinder', () => {
    let db;
    let finder;

    beforeEach(() => {
      const tables = basicTables();
      db = createMockDb(tables);
      finder = createPlayerFinder(db);
    });

    it('finds existing player by melee_name', async () => {
      const tables = basicTables();
      tables.players.push({ id: 'P010', name: 'Test Player', melee_name: 'TestMelee', active: 1 });
      db = createMockDb(tables);
      finder = createPlayerFinder(db);

      const id = await finder.find('TestMelee', 'Test Player');
      assert.equal(id, 'P010');
    });

    it('creates new player when not found', async () => {
      db = createMockDb(basicTables());
      finder = createPlayerFinder(db);

      const id = await finder.find('NewMelee', 'New Player');
      assert.match(id, /^P\d{3}$/);

      const store = db.getStore();
      const player = store.players.find(p => p.melee_name === 'NewMelee');
      assert.ok(player);
      assert.equal(player.name, 'New Player');
      assert.equal(player.active, 1);
    });

    it('uses cache on subsequent calls', async () => {
      db = createMockDb(basicTables());
      finder = createPlayerFinder(db);

      const id1 = await finder.find('CachedMelee', 'Cached Player');
      const id2 = await finder.find('CachedMelee', 'Cached Player');
      assert.equal(id1, id2);
    });

    it('recovers from stale cache', async () => {
      const tables = basicTables();
      db = createMockDb(tables);
      finder = createPlayerFinder(db);

      const store = db.getStore();
      store.players.push({ id: 'P099', name: 'Stale', melee_name: 'StaleMelee', active: 1 });

      const id = await finder.find('StaleMelee', 'Stale');
      assert.equal(id, 'P099');
    });
  });

  describe('fetchLeagueTournaments', () => {
    it('returns empty array when client returns no content', async () => {
      const client = { listTournaments: async () => ({ Content: [], TotalCount: 0 }) };
      const result = await fetchLeagueTournaments(client);
      assert.deepEqual(result, []);
    });

    it('filters only league tournaments', async () => {
      const tournaments = [
        { ID: 1, Name: 'SWU Wednesday league season 6 15/7 (week 1)', StartDate: '2026-07-15' },
        { ID: 2, Name: 'Random draft tournament', StartDate: '2026-07-16' },
        { ID: 3, Name: 'SWU Wednesday league season 6 22/7 (week 2)', StartDate: '2026-07-22' },
      ];
      const client = { listTournaments: async () => ({ Content: tournaments, TotalCount: 3 }) };
      const result = await fetchLeagueTournaments(client);
      assert.equal(result.length, 2);
    });

    it('paginates through multiple pages', async () => {
      const page0 = [
        { ID: 1, Name: 'SWU Wednesday league season 6 15/7 (week 1)', StartDate: '2026-07-15' },
      ];
      const page1 = [
        { ID: 2, Name: 'SWU Wednesday league season 6 22/7 (week 2)', StartDate: '2026-07-22' },
      ];
      let callCount = 0;
      const client = {
        listTournaments: async (_, page) => {
          callCount++;
          if (page === 0) return { Content: page0, TotalCount: 500 };
          return { Content: page1, TotalCount: 500 };
        },
      };
      const result = await fetchLeagueTournaments(client);
      assert.equal(result.length, 2);
      assert.equal(callCount, 2);
    });

    it('filters by targetSeason', async () => {
      const tournaments = [
        { ID: 1, Name: 'SWU Wednesday league season 6 15/7 (week 1)', StartDate: '2026-07-15' },
        { ID: 2, Name: 'SWU Wednesday league season 5 10/6 (week 1)', StartDate: '2026-06-10' },
      ];
      const client = { listTournaments: async () => ({ Content: tournaments, TotalCount: 2 }) };
      const result = await fetchLeagueTournaments(client, { targetSeason: 6 });
      assert.equal(result.length, 1);
      assert.equal(result[0].seasonNum, 6);
    });

    it('skips tournaments without dates', async () => {
      const tournaments = [
        { ID: 1, Name: 'SWU Wednesday league season 6 15/7 (week 1)', StartDate: null, LastPairDateTime: null },
      ];
      const client = { listTournaments: async () => ({ Content: tournaments, TotalCount: 1 }) };
      const result = await fetchLeagueTournaments(client);
      assert.equal(result.length, 0);
    });

    it('adds phase classification to results', async () => {
      const tournaments = [
        { ID: 1, Name: 'SWU Wednesday league season 6 15/7 (week 1)', StartDate: '2026-07-15' },
        { ID: 2, Name: 'SWU Wednesday league season 6 TOP 4', StartDate: '2026-09-30' },
      ];
      const client = { listTournaments: async () => ({ Content: tournaments, TotalCount: 2 }) };
      const result = await fetchLeagueTournaments(client);
      const regular = result.find(r => r.ID === 1);
      const cut = result.find(r => r.ID === 2);
      assert.equal(regular.phase, 'regular');
      assert.equal(cut.phase, 'cut');
    });

    it('sorts results deterministically', async () => {
      const tournaments = [
        { ID: 3, Name: 'SWU Wednesday league season 6 22/7 (week 2)', StartDate: '2026-07-22' },
        { ID: 1, Name: 'SWU Wednesday league season 6 15/7 (week 1)', StartDate: '2026-07-15' },
      ];
      const client = { listTournaments: async () => ({ Content: tournaments, TotalCount: 2 }) };
      const result = await fetchLeagueTournaments(client);
      assert.equal(result[0].ID, 1);
      assert.equal(result[1].ID, 3);
    });
  });
});
