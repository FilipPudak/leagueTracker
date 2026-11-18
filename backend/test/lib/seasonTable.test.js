import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { nightPoints, computeSeasonTable } from '../../src/lib/seasonTable.js';

describe('seasonTable', () => {
  describe('nightPoints', () => {
    it('calculates 3*W + D', () => {
      assert.equal(nightPoints({ wins: 3, draws: 0, losses: 0 }), 9);
      assert.equal(nightPoints({ wins: 2, draws: 1, losses: 0 }), 7);
      assert.equal(nightPoints({ wins: 1, draws: 1, losses: 1 }), 4);
      assert.equal(nightPoints({ wins: 0, draws: 0, losses: 3 }), 0);
    });
  });

  describe('computeSeasonTable', () => {
    it('picks best X nights by points', () => {
      const nights = [
        { playerId: 'P1', round: 1, wins: 3, draws: 0, losses: 0, rank: 1 },
        { playerId: 'P1', round: 2, wins: 2, draws: 1, losses: 0, rank: 2 },
        { playerId: 'P1', round: 3, wins: 1, draws: 0, losses: 2, rank: 5 },
      ];
      const result = computeSeasonTable(nights, 2);
      assert.equal(result.length, 1);
      assert.equal(result[0].rounds.length, 2);
      assert.equal(result[0].points, 16);
    });

    it('keeps earlier night on boundary tie', () => {
      const nights = [
        { playerId: 'P1', round: 3, wins: 2, draws: 1, losses: 0, rank: 2 },
        { playerId: 'P1', round: 1, wins: 2, draws: 1, losses: 0, rank: 2 },
        { playerId: 'P1', round: 2, wins: 2, draws: 1, losses: 0, rank: 2 },
      ];
      const result = computeSeasonTable(nights, 2);
      assert.equal(result[0].rounds[0].round, 1);
      assert.equal(result[0].rounds[1].round, 2);
    });

    it('aggregates P/W/D/L correctly', () => {
      const nights = [
        { playerId: 'P1', round: 1, wins: 3, draws: 0, losses: 0, rank: 1 },
        { playerId: 'P1', round: 2, wins: 2, draws: 1, losses: 0, rank: 2 },
      ];
      const result = computeSeasonTable(nights, 2);
      assert.equal(result[0].played, 6);
      assert.equal(result[0].won, 5);
      assert.equal(result[0].drawn, 1);
      assert.equal(result[0].lost, 0);
    });

    it('ranks by points desc, then undefeated nights, then night-rank sum', () => {
      const nights = [
        { playerId: 'P1', round: 1, wins: 3, draws: 0, losses: 0, rank: 1 },
        { playerId: 'P1', round: 2, wins: 3, draws: 0, losses: 0, rank: 1 },
        { playerId: 'P2', round: 1, wins: 3, draws: 0, losses: 0, rank: 1 },
        { playerId: 'P2', round: 2, wins: 2, draws: 1, losses: 0, rank: 2 },
      ];
      const result = computeSeasonTable(nights, 2);
      assert.equal(result[0].playerId, 'P1');
      assert.equal(result[1].playerId, 'P2');
    });

    it('undefeated tiebreaker requires a full night won outright', () => {
      const nights = [
        { playerId: 'P1', round: 1, wins: 4, draws: 0, losses: 0, rank: 1 },
        { playerId: 'P1', round: 2, wins: 2, draws: 0, losses: 2, rank: 3 },
        { playerId: 'P2', round: 1, wins: 3, draws: 1, losses: 0, rank: 2 },
        { playerId: 'P2', round: 2, wins: 2, draws: 2, losses: 0, rank: 2 },
      ];
      const result = computeSeasonTable(nights, 2);
      assert.equal(result[0].playerId, 'P1');
      assert.equal(result[0].points, 18);
      assert.equal(result[0].undefeatedNights, 1);
      assert.equal(result[1].playerId, 'P2');
      assert.equal(result[1].points, 18);
      assert.equal(result[1].undefeatedNights, 0);
      assert.equal(result[1].nightRankSum, result[0].nightRankSum);
    });

    it('a short night with only wins is not undefeated', () => {
      const nights = [
        { playerId: 'P1', round: 1, wins: 2, draws: 0, losses: 0, rank: 1 },
        { playerId: 'P2', round: 1, wins: 4, draws: 0, losses: 0, rank: 2 },
      ];
      const result = computeSeasonTable(nights, 1);
      const p1 = result.find(r => r.playerId === 'P1');
      const p2 = result.find(r => r.playerId === 'P2');
      assert.equal(p1.undefeatedNights, 0);
      assert.equal(p2.undefeatedNights, 1);
    });

    it('shares rank when still tied after all tiebreakers', () => {
      const nights = [
        { playerId: 'P1', round: 1, wins: 3, draws: 0, losses: 0, rank: 1 },
        { playerId: 'P1', round: 2, wins: 3, draws: 0, losses: 0, rank: 1 },
        { playerId: 'P2', round: 1, wins: 3, draws: 0, losses: 0, rank: 1 },
        { playerId: 'P2', round: 2, wins: 3, draws: 0, losses: 0, rank: 1 },
        { playerId: 'P3', round: 1, wins: 2, draws: 1, losses: 0, rank: 2 },
        { playerId: 'P3', round: 2, wins: 2, draws: 1, losses: 0, rank: 2 },
      ];
      const result = computeSeasonTable(nights, 2);
      assert.equal(result[0].rank, 1);
      assert.equal(result[1].rank, 1);
      assert.equal(result[2].rank, 3);
    });

    it('handles player with fewer nights than topResults', () => {
      const nights = [
        { playerId: 'P1', round: 1, wins: 3, draws: 0, losses: 0, rank: 1 },
      ];
      const result = computeSeasonTable(nights, 3);
      assert.equal(result[0].rounds.length, 1);
      assert.equal(result[0].played, 3);
    });
  });
});
