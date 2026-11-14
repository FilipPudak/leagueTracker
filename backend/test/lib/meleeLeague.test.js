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

    it('numbers a new tournament past the highest existing round (no UNIQUE collision)', () => {
      const tournaments = [
        { ID: 462767, Name: 'SWU Wednesday league season 7 9/9', StartDate: '2026-09-09', phase: 'regular' },
        { ID: 466139, Name: 'SWU Wednesday league season 7 16/9 (week 2) ', StartDate: '2026-09-16', phase: 'regular' },
      ];
      const existingRoundMap = new Map([[462767, 1]]);
      const weekMap = buildWeekMap(tournaments, existingRoundMap);
      assert.equal(weekMap.get(462767).round, 1);
      assert.equal(weekMap.get(466139).round, 2);
    });

    it('numbers specials after new regulars when rounds come from the DB', () => {
      const tournaments = [
        { ID: 100, Name: 'SWU Wednesday league season 6 15/7', StartDate: '2026-07-15', phase: 'regular' },
        { ID: 101, Name: 'SWU Wednesday league season 6 22/7', StartDate: '2026-07-22', phase: 'regular' },
        { ID: 102, Name: 'SWU Wednesday league season 6 TOP 8', StartDate: '2026-07-29', phase: 'cut' },
      ];
      const existingRoundMap = new Map([[100, 1]]);
      const weekMap = buildWeekMap(tournaments, existingRoundMap);
      assert.equal(weekMap.get(100).round, 1);
      assert.equal(weekMap.get(101).round, 2);
      assert.equal(weekMap.get(102).round, 3);
    });

    it('reserves rounds of stored tournaments absent from the fetched list', () => {
      const tournaments = [
        { ID: 200, Name: 'SWU Wednesday league season 6 22/7', StartDate: '2026-07-22', phase: 'regular' },
      ];
      const existingRoundMap = new Map([[100, 1]]);
      const weekMap = buildWeekMap(tournaments, existingRoundMap);
      assert.equal(weekMap.get(200).round, 2);
    });

    it('includes phase in map entries', () => {
      const tournaments = [
        { ID: 100, Name: 'SWU Wednesday league season 6 TOP 8', phase: 'cut' },
      ];
      const weekMap = buildWeekMap(tournaments);
      assert.equal(weekMap.get(100).phase, 'cut');
    });

    it('carries Melee Status onto regular and special weekMap entries', () => {
      const tournaments = [
        { ID: 100, Name: 'SWU Wednesday league season 6 15/7', StartDate: '2026-07-15', phase: 'regular', Status: 4, StatusDescription: 'Ended' },
        { ID: 101, Name: 'SWU Wednesday league season 6 TOP 8', StartDate: '2026-07-22', phase: 'cut', Status: 2, StatusDescription: 'Running' },
      ];
      const weekMap = buildWeekMap(tournaments);
      assert.equal(weekMap.get(100).status, 4);
      assert.equal(weekMap.get(100).statusDescription, 'Ended');
      assert.equal(weekMap.get(101).status, 2, 'specials must carry status too (champion guard)');
    });

    it('leaves status undefined when the API omits it', () => {
      const tournaments = [
        { ID: 100, Name: 'SWU Wednesday league season 6 15/7', StartDate: '2026-07-15', phase: 'regular' },
      ];
      const weekMap = buildWeekMap(tournaments);
      assert.equal(weekMap.get(100).status, undefined);
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

    it('refreshes players.name from the Melee DisplayName on every hit', async () => {
      const tables = basicTables();
      tables.players.push({ id: 'P010', name: 'Old Name', melee_name: 'TestMelee', active: 1 });
      db = createMockDb(tables);
      finder = createPlayerFinder(db);

      await finder.find('TestMelee', 'New Display');
      assert.equal(db.getStore().players.find(p => p.id === 'P010').name, 'New Display');
    });

    it('never rewrites players.name from a blank DisplayName', async () => {
      const tables = basicTables();
      tables.players.push({ id: 'P010', name: 'Chosen Name', melee_name: 'TestMelee', active: 1 });
      db = createMockDb(tables);
      finder = createPlayerFinder(db);

      await finder.find('TestMelee', null);
      await finder.find('TestMelee', '');
      assert.equal(db.getStore().players.find(p => p.id === 'P010').name, 'Chosen Name');
    });

    it('writes nothing when the display name is unchanged', async () => {
      const tables = basicTables();
      tables.players.push({ id: 'P010', name: 'Same Name', melee_name: 'TestMelee', active: 1 });
      db = createMockDb(tables);
      finder = createPlayerFinder(db);

      await finder.find('TestMelee', 'Same Name');
      const writes = db.getCalls().filter(c => /UPDATE\s+players\s+SET\s+name/i.test(c.sql));
      assert.equal(writes.length, 0);
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

  describe('createPlayerFinder – username history (M6)', () => {
    function playerTables() {
      const tables = basicTables();
      tables.players.push({ id: 'P053', name: 'Takras_Ola', melee_name: 'Takras_Ola', melee_guid: null, email: 'ola@test.com', active: 1 });
      tables.player_usernames = [
        { player_id: 'P053', melee_name: 'Takras_Ola', name_lower: 'takras_ola', source: 'seed', first_seen: null, last_seen: '2026-01-01T00:00:00.000Z' },
      ];
      return tables;
    }

    it('resolves a declared-before-rename name through history without creating a row', async () => {
      const tables = playerTables();
      tables.player_usernames.push({ player_id: 'P053', melee_name: 'ola_la', name_lower: 'ola_la', source: 'admin', first_seen: null, last_seen: '2026-10-01T00:00:00.000Z' });
      const db = createMockDb(tables);
      const finder = createPlayerFinder(db);

      const id = await finder.find('ola_la', 'ola_la');
      assert.equal(id, 'P053');
      assert.equal(db.getStore().players.length, tables.players.length, 'history hit must not auto-create');
      const historyRow = db.getStore().player_usernames.find(r => r.melee_name === 'ola_la');
      assert.ok(historyRow.last_seen > '2026-10-01T00:00:00.000Z', 'history hit bumps last_seen');
    });

    it('auto-creates an unknown name and seeds its history row', async () => {
      const db = createMockDb(playerTables());
      const finder = createPlayerFinder(db);

      const id = await finder.find('brand_new', 'Brand New');
      const created = db.getStore().players.find(p => p.id === id);
      assert.ok(created);
      const historyRow = db.getStore().player_usernames.find(r => r.player_id === id);
      assert.equal(historyRow.melee_name, 'brand_new');
      assert.equal(historyRow.source, 'sync');
      assert.equal(historyRow.name_lower, 'brand_new');
      assert.ok(historyRow.first_seen, 'freshly seen name records first_seen');
    });

    it('auto-creates when history points at multiple past owners', async () => {
      const tables = playerTables();
      tables.players.push({ id: 'P060', name: 'Other', melee_name: 'other_name', email: null, active: 1 });
      tables.player_usernames.push(
        { player_id: 'P053', melee_name: 'shared_name', name_lower: 'shared_name', source: 'merge', first_seen: null, last_seen: '2026-01-01T00:00:00.000Z' },
        { player_id: 'P060', melee_name: 'shared_name', name_lower: 'shared_name', source: 'merge', first_seen: null, last_seen: '2026-01-01T00:00:00.000Z' },
      );
      const db = createMockDb(tables);
      const finder = createPlayerFinder(db);

      const id = await finder.find('shared_name', 'Shared Name');
      assert.notEqual(id, 'P053');
      assert.notEqual(id, 'P060');
      assert.equal(db.getStore().players.filter(p => p.melee_name === 'shared_name').length, 1);
    });

    it('auto-creates instead of trusting history when AsmoConnectId differs (recycled name)', async () => {
      const tables = playerTables();
      tables.players = tables.players.map(p => p.id === 'P053' ? { ...p, melee_guid: 'ASMO-OLD' } : p);
      tables.player_usernames.push({ player_id: 'P053', melee_name: 'recycled', name_lower: 'recycled', source: 'merge', first_seen: null, last_seen: '2026-01-01T00:00:00.000Z' });
      const db = createMockDb(tables);
      const finder = createPlayerFinder(db);

      const id = await finder.find('recycled', 'Recycled', 'ASMO-NEW');
      assert.notEqual(id, 'P053', 'mismatched AsmoConnectId must not inherit the history owner');
    });

    it('accepts a single history match when AsmoConnectId is missing on either side', async () => {
      const tables = playerTables();
      tables.players = tables.players.map(p => p.id === 'P053' ? { ...p, melee_guid: 'ASMO-OLD' } : p);
      tables.player_usernames.push({ player_id: 'P053', melee_name: 'no_asmo', name_lower: 'no_asmo', source: 'merge', first_seen: null, last_seen: '2026-01-01T00:00:00.000Z' });
      const db = createMockDb(tables);
      const finder = createPlayerFinder(db);

      const id = await finder.find('no_asmo', 'No Asmo');
      assert.equal(id, 'P053');
    });

    it('captures AsmoConnectId onto players.melee_guid when unknown', async () => {
      const tables = playerTables();
      const db = createMockDb(tables);
      const finder = createPlayerFinder(db);

      await finder.find('Takras_Ola', 'Takras_Ola', 'ASMO-1');
      assert.equal(db.getStore().players.find(p => p.id === 'P053').melee_guid, 'ASMO-1');
    });

    it('matches the DB fallback case-insensitively for names added after init', async () => {
      const tables = playerTables();
      const db = createMockDb(tables);
      const finder = createPlayerFinder(db);

      await finder.find('warmup_name', 'Warmup');
      db.getStore().players.push({ id: 'P100', name: 'Case Player', melee_name: 'CasePlayer', email: null, active: 1 });

      const id = await finder.find('caseplayer', 'Case Player');
      assert.equal(id, 'P100');
      assert.equal(db.getStore().players.filter(p => p.melee_name === 'CasePlayer').length, 1);
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
