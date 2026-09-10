import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMockDb } from '../helpers/mock-db.js';
import { basicTables } from '../helpers/fixtures.js';
import { handleGetStandingsData } from '../../src/handlers/getStandingsData.js';

function makeTables(overrides = {}) {
  const t = basicTables();
  if (overrides.seasons) t.seasons = overrides.seasons;
  if (overrides.season_standings) t.season_standings = overrides.season_standings;
  if (overrides.melee_tournaments) t.melee_tournaments = overrides.melee_tournaments;
  return t;
}

describe('handleGetStandingsData', () => {
  it('returns season table with rankings', async () => {
    const tables = makeTables({
      melee_tournaments: [
        { melee_id: 100, season_id: 6, round: 1, name: 'SWU Wednesday league season 6 15/7 (week 1)', date: '2026-06-15', phase: 'regular' },
        { melee_id: 101, season_id: 6, round: 2, name: 'SWU Wednesday league season 6 22/7 (week 2)', date: '2026-06-22', phase: 'regular' },
      ],
      season_standings: [
        { season_id: 6, round: 1, player_id: 'P001', wins: 3, losses: 0, draws: 0, match_points: 9, rank: 1 },
        { season_id: 6, round: 1, player_id: 'P002', wins: 2, losses: 1, draws: 0, match_points: 6, rank: 2 },
        { season_id: 6, round: 2, player_id: 'P001', wins: 3, losses: 0, draws: 0, match_points: 9, rank: 1 },
        { season_id: 6, round: 2, player_id: 'P002', wins: 2, losses: 1, draws: 0, match_points: 6, rank: 2 },
      ],
    });
    const db = createMockDb(tables);

    const result = await handleGetStandingsData({ seasonId: 6 }, { DB: db });

    assert.ok(result.table.length > 0);
    assert.equal(result.table[0].playerId, 'P001');
    assert.equal(result.table[0].points, 18);
  });

  it('returns per-round night results in descending order', async () => {
    const tables = makeTables({
      melee_tournaments: [
        { melee_id: 100, season_id: 6, round: 1, name: 'SWU Wednesday league season 6 15/7 (week 1)', date: '2026-06-15', phase: 'regular' },
        { melee_id: 101, season_id: 6, round: 2, name: 'SWU Wednesday league season 6 22/7 (week 2)', date: '2026-06-22', phase: 'regular' },
      ],
      season_standings: [
        { season_id: 6, round: 1, player_id: 'P001', wins: 3, losses: 0, draws: 0, match_points: 9, rank: 1 },
        { season_id: 6, round: 2, player_id: 'P001', wins: 3, losses: 0, draws: 0, match_points: 9, rank: 1 },
      ],
    });
    const db = createMockDb(tables);

    const result = await handleGetStandingsData({ seasonId: 6 }, { DB: db });

    assert.equal(result.rounds.length, 2);
    assert.equal(result.rounds[0].round, 2);
    assert.equal(result.rounds[0].phase, 'regular');
    assert.equal(result.rounds[1].round, 1);
  });

  it('filters table by asOfRound when provided', async () => {
    const tables = makeTables({
      melee_tournaments: [
        { melee_id: 100, season_id: 6, round: 1, name: 'SWU Wednesday league season 6 15/7 (week 1)', date: '2026-06-15', phase: 'regular' },
        { melee_id: 101, season_id: 6, round: 2, name: 'SWU Wednesday league season 6 22/7 (week 2)', date: '2026-06-22', phase: 'regular' },
      ],
      season_standings: [
        { season_id: 6, round: 1, player_id: 'P001', wins: 3, losses: 0, draws: 0, match_points: 9, rank: 1 },
        { season_id: 6, round: 2, player_id: 'P001', wins: 3, losses: 0, draws: 0, match_points: 9, rank: 1 },
      ],
    });
    const db = createMockDb(tables);

    const result = await handleGetStandingsData({ seasonId: 6, asOfRound: 1 }, { DB: db });

    assert.equal(result.table[0].rounds.length, 1);
    assert.equal(result.table[0].rounds[0].round, 1);
    assert.equal(result.asOfRound, 1);
  });

  it('labels cut and side phases', async () => {
    const tables = makeTables({
      melee_tournaments: [
        { melee_id: 100, season_id: 6, round: 1, name: 'SWU Wednesday league season 6 15/7 (week 1)', date: '2026-06-15', phase: 'regular' },
        { melee_id: 101, season_id: 6, round: 12, name: 'SWU Wednesday league season 6 TOP 8', date: '2026-09-01', phase: 'cut' },
        { melee_id: 102, season_id: 6, round: 13, name: 'SWU Wednesday league season 6 Best of the Rest', date: '2026-09-01', phase: 'side' },
      ],
      season_standings: [
        { season_id: 6, round: 1, player_id: 'P001', wins: 3, losses: 0, draws: 0, match_points: 9, rank: 1 },
        { season_id: 6, round: 12, player_id: 'P001', wins: 3, losses: 0, draws: 0, match_points: 9, rank: 1 },
        { season_id: 6, round: 13, player_id: 'P001', wins: 3, losses: 0, draws: 0, match_points: 9, rank: 1 },
      ],
    });
    const db = createMockDb(tables);

    const result = await handleGetStandingsData({ seasonId: 6, asOfRound: 13 }, { DB: db });

    const cutRound = result.rounds.find(r => r.phase === 'cut');
    const sideRound = result.rounds.find(r => r.phase === 'side');
    assert.equal(cutRound.phase, 'cut');
    assert.equal(sideRound.phase, 'side');
  });

  it('defaults to latest regular round when no asOfRound', async () => {
    const tables = makeTables({
      melee_tournaments: [
        { melee_id: 100, season_id: 6, round: 1, name: 'SWU Wednesday league season 6 15/7 (week 1)', date: '2026-06-15', phase: 'regular' },
        { melee_id: 101, season_id: 6, round: 2, name: 'SWU Wednesday league season 6 22/7 (week 2)', date: '2026-06-22', phase: 'regular' },
      ],
      season_standings: [
        { season_id: 6, round: 1, player_id: 'P001', wins: 3, losses: 0, draws: 0, match_points: 9, rank: 1 },
        { season_id: 6, round: 2, player_id: 'P001', wins: 3, losses: 0, draws: 0, match_points: 9, rank: 1 },
      ],
    });
    const db = createMockDb(tables);

    const result = await handleGetStandingsData({ seasonId: 6 }, { DB: db });

    assert.equal(result.asOfRound, 2);
  });

  it('missing seasonId → 400', async () => {
    const db = createMockDb(makeTables());
    await assert.rejects(
      () => handleGetStandingsData({}, { DB: db }),
      (err) => {
        assert.equal(err.status, 400);
        assert.match(err.message, /seasonId is required/);
        return true;
      }
    );
  });

  it('null seasonId → 400', async () => {
    const db = createMockDb(makeTables());
    await assert.rejects(
      () => handleGetStandingsData({ seasonId: null }, { DB: db }),
      (err) => { assert.equal(err.status, 400); return true; }
    );
  });

  it('garbage seasonId → 400 instead of silent empty result', async () => {
    const db = createMockDb(makeTables());
    await assert.rejects(
      () => handleGetStandingsData({ seasonId: 'banana' }, { DB: db }),
      (err) => {
        assert.equal(err.status, 400);
        assert.match(err.message, /Invalid seasonId/);
        return true;
      }
    );
  });

  it('accepts prefixed seasonId "S6" form', async () => {
    const db = createMockDb(makeTables());
    const result = await handleGetStandingsData({ seasonId: 'S6' }, { DB: db });
    assert.ok(Array.isArray(result.table));
  });

  it('rejects non-numeric asOfRound with 400', async () => {
    const db = createMockDb(makeTables());
    await assert.rejects(
      () => handleGetStandingsData({ seasonId: 6, asOfRound: 'abc' }, { DB: db }),
      (err) => {
        assert.equal(err.status, 400);
        assert.match(err.message, /Invalid asOfRound/);
        return true;
      }
    );
  });

  it('rejects negative asOfRound with 400', async () => {
    const db = createMockDb(makeTables());
    await assert.rejects(
      () => handleGetStandingsData({ seasonId: 6, asOfRound: -1 }, { DB: db }),
      (err) => { assert.equal(err.status, 400); return true; }
    );
  });

  it('rejects zero asOfRound with 400', async () => {
    const db = createMockDb(makeTables());
    await assert.rejects(
      () => handleGetStandingsData({ seasonId: 6, asOfRound: 0 }, { DB: db }),
      (err) => { assert.equal(err.status, 400); return true; }
    );
  });
});
