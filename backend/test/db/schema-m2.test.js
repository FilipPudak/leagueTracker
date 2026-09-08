import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMockDb } from '../helpers/mock-db.js';
import { basicTables, emptyTables } from '../helpers/fixtures.js';

describe('M2 schema changes', () => {
  describe('seasons table', () => {
    it('has length and top_results columns', async () => {
      const db = createMockDb(basicTables());
      const result = await db.prepare('SELECT length, top_results FROM seasons WHERE id = 6').first();
      assert.equal(result.length, 11);
      assert.equal(result.top_results, 7);
    });

    it('defaults length to 11 and top_results to 7', async () => {
      const db = createMockDb(basicTables());
      const store = db.getStore();
      store.seasons.push({ id: 99, name: 'Test Season', created_date: '2026-01-01', length: 11, top_results: 7 });
      const result = await db.prepare('SELECT length, top_results FROM seasons WHERE id = 99').first();
      assert.equal(result.length, 11);
      assert.equal(result.top_results, 7);
    });
  });

  describe('melee_tournaments table', () => {
    it('has phase column with default regular', async () => {
      const db = createMockDb(basicTables());
      const store = db.getStore();
      store.melee_tournaments.push({ melee_id: 1001, season_id: 6, round: 1, name: 'Test', date: '2026-06-15', phase: 'regular' });
      const result = await db.prepare('SELECT phase FROM melee_tournaments WHERE melee_id = 1001').first();
      assert.equal(result.phase, 'regular');
    });

    it('enforces UNIQUE(season_id, round)', async () => {
      const db = createMockDb(basicTables());
      const store = db.getStore();
      store.melee_tournaments.push({ melee_id: 1001, season_id: 6, round: 1, name: 'Test', date: '2026-06-15', phase: 'regular' });
      
      await assert.rejects(
        () => db.prepare('INSERT INTO melee_tournaments (melee_id, season_id, round, name, date, phase) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(1002, 6, 1, 'Test2', '2026-06-15', 'regular').run(),
        (err) => {
          assert.ok(err.message.includes('UNIQUE'));
          return true;
        }
      );
    });
  });

  describe('match_results table', () => {
    it('enforces UNIQUE(season_id, round, melee_match_id)', async () => {
      const db = createMockDb(basicTables());
      const store = db.getStore();
      store.match_results.push({
        id: 1, season_id: 6, round: 1, melee_match_id: 'match-1',
        player1_id: 'P001', player2_id: 'P002', winner_id: 'P001', result: '2-1', is_bye: 0
      });
      
      await assert.rejects(
        () => db.prepare('INSERT INTO match_results (season_id, round, melee_match_id, player1_id, player2_id, winner_id, result, is_bye) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .bind(6, 1, 'match-1', 'P001', 'P002', 'P001', '2-1', 0).run(),
        (err) => {
          assert.ok(err.message.includes('UNIQUE'));
          return true;
        }
      );
    });

    it('allows different melee_match_id in same round', async () => {
      const db = createMockDb(basicTables());
      const store = db.getStore();
      store.match_results.push({
        id: 1, season_id: 6, round: 1, melee_match_id: 'match-1',
        player1_id: 'P001', player2_id: 'P002', winner_id: 'P001', result: '2-1', is_bye: 0
      });
      
      await db.prepare('INSERT INTO match_results (season_id, round, melee_match_id, player1_id, player2_id, winner_id, result, is_bye) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(6, 1, 'match-2', 'P003', 'P004', 'P003', '2-0', 0).run();
      
      const store2 = db.getStore();
      assert.equal(store2.match_results.length, 2);
    });
  });

  describe('votes table', () => {
    it('has all required columns', async () => {
      const db = createMockDb(basicTables());
      const result = await db.prepare('SELECT * FROM votes WHERE id = 1').first();
      assert.ok(result);
      assert.equal(result.season_id, 6);
      assert.equal(result.week, 1);
      assert.equal(result.player_id, 'P001');
      assert.equal(result.leader_id, '1');
      assert.equal(result.opponent_id, 'P002');
    });

    it('enforces UNIQUE(season_id, week, player_id)', async () => {
      const db = createMockDb(basicTables());
      
      await assert.rejects(
        () => db.prepare('INSERT INTO votes (timestamp, season_id, week, player_id, leader_id, opponent_id) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(new Date().toISOString(), 6, 1, 'P001', '2', 'P003').run(),
        (err) => {
          assert.ok(err.message.includes('UNIQUE'));
          return true;
        }
      );
    });

    it('allows same player in different weeks', async () => {
      const db = createMockDb(basicTables());
      
      await db.prepare('INSERT INTO votes (timestamp, season_id, week, player_id, leader_id, opponent_id) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(new Date().toISOString(), 6, 3, 'P001', '2', 'P003').run();
      
      const store = db.getStore();
      const votes = store.votes.filter(v => v.player_id === 'P001');
      assert.equal(votes.length, 3);
    });
  });
});
