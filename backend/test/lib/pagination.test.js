import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MeleeClient } from '../../src/lib/melee.js';

describe('MeleeClient pagination', () => {
  describe('getStandings', () => {
    it('loops until HasMore=false', async () => {
      const responses = [
        { Content: [{ standing: 1 }], HasMore: true },
        { Content: [{ standing: 2 }], HasMore: false },
      ];
      let callIndex = 0;
      const client = new MeleeClient('id', 'secret');
      client._fetch = async () => responses[callIndex++];

      const result = await client.getStandings(123);
      assert.equal(result.Content.length, 2);
      assert.deepEqual(result.Content[0], { standing: 1 });
      assert.deepEqual(result.Content[1], { standing: 2 });
    });

    it('single page when HasMore=false immediately', async () => {
      const client = new MeleeClient('id', 'secret');
      client._fetch = async () => ({ Content: [{ standing: 1 }], HasMore: false });

      const result = await client.getStandings(123);
      assert.equal(result.Content.length, 1);
    });

    it('handles HasMore undefined as false', async () => {
      const client = new MeleeClient('id', 'secret');
      client._fetch = async () => ({ Content: [{ standing: 1 }] });

      const result = await client.getStandings(123);
      assert.equal(result.Content.length, 1);
    });
  });

  describe('getMatches', () => {
    it('loops until HasMore=false', async () => {
      const responses = [
        { Content: [{ match: 1 }], HasMore: true },
        { Content: [{ match: 2 }], HasMore: true },
        { Content: [{ match: 3 }], HasMore: false },
      ];
      let callIndex = 0;
      const client = new MeleeClient('id', 'secret');
      client._fetch = async () => responses[callIndex++];

      const result = await client.getMatches(123);
      assert.equal(result.Content.length, 3);
    });
  });

  describe('fetchLeagueTournaments', () => {
    it('deduplicates and filters by season', async () => {
      const { fetchLeagueTournaments } = await import('../../src/lib/meleeLeague.js');
      const tournaments = [
        { ID: 1, Name: 'SWU Wednesday league season 6 15/7 (week 1)', StartDate: '2026-06-15' },
        { ID: 2, Name: 'SWU Wednesday league season 6 22/7 (week 2)', StartDate: '2026-06-22' },
        { ID: 3, Name: 'SWU Wednesday league season 5 15/7 (week 1)', StartDate: '2026-06-15' },
      ];

      const client = new MeleeClient('id', 'secret');
      client.listTournaments = async () => ({
        Content: tournaments,
        RecordsTotal: 3,
      });

      const result = await fetchLeagueTournaments(client, { targetSeason: 6 });
      assert.equal(result.length, 2);
      assert.ok(result.every(t => t.seasonNum === 6));
    });

    it('handles multi-page fetch', async () => {
      const { fetchLeagueTournaments } = await import('../../src/lib/meleeLeague.js');
      let page = 0;
      const client = new MeleeClient('id', 'secret');
      client.listTournaments = async (org, p) => {
        page = p;
        if (p === 0) return { Content: [{ ID: 1, Name: 'SWU Wednesday league season 6 15/7 (week 1)', StartDate: '2026-06-15' }], RecordsTotal: 300 };
        return { Content: [{ ID: 2, Name: 'SWU Wednesday league season 6 22/7 (week 2)', StartDate: '2026-06-22' }], RecordsTotal: 300 };
      };

      const result = await fetchLeagueTournaments(client, { targetSeason: 6 });
      assert.equal(result.length, 2);
      assert.equal(page, 1);
    });
  });
});
