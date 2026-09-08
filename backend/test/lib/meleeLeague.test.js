import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { classifyPhase, isLeagueTournament, extractSeasonAndRound, resolveRound, sortRoundsDeterministic, buildWeekMap, createPlayerFinder } from '../../src/lib/meleeLeague.js';
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

  describe('resolveRound', () => {
    it('uses explicit week when provided', () => {
      assert.equal(resolveRound('name', 5, 10), 5);
    });

    it('falls back to positional seq', () => {
      assert.equal(resolveRound('SWU Wednesday league no week label', null, 3), 3);
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
    it('builds map with explicit weeks', () => {
      const tournaments = [
        { ID: 100, Name: 'SWU Wednesday league season 6 15/7 (week 3)', extractedWeek: 3, phase: 'regular' },
        { ID: 101, Name: 'SWU Wednesday league season 6 22/7 (week 4)', extractedWeek: 4, phase: 'regular' },
      ];
      const weekMap = buildWeekMap(tournaments);
      assert.equal(weekMap.size, 2);
      assert.equal(weekMap.get(100).round, 3);
      assert.equal(weekMap.get(101).round, 4);
    });

    it('assigns sequential rounds when no explicit week', () => {
      const tournaments = [
        { ID: 100, Name: 'SWU Wednesday league season 6 15/7', extractedWeek: null, phase: 'regular' },
        { ID: 101, Name: 'SWU Wednesday league season 6 22/7', extractedWeek: null, phase: 'regular' },
      ];
      const weekMap = buildWeekMap(tournaments);
      assert.equal(weekMap.get(100).round, 1);
      assert.equal(weekMap.get(101).round, 2);
    });

    it('includes phase in map entries', () => {
      const tournaments = [
        { ID: 100, Name: 'SWU Wednesday league season 6 TOP 8', extractedWeek: null, phase: 'cut' },
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
});
