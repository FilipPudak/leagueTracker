import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMockDb } from '../helpers/mock-db.js';
import { basicTables, emptyTables, closedVotingTables } from '../helpers/fixtures.js';
import { installCryptoMock } from '../helpers/mock-crypto.js';
import { handleGetLeaderboardData } from '../../src/handlers/getLeaderboardData.js';

function leaderboardTables() {
  const t = basicTables();
  t.settings = t.settings.map(s =>
    s.key === 'ACTIVE_SEASON_ID' ? { ...s, value: '6' } : s
  );
  return t;
}

function tablesWithoutAwards() {
  const t = leaderboardTables();
  t.awards = [];
  return t;
}

function tablesWithStandings() {
  const t = tablesWithoutAwards();
  t.season_standings = [
    // Round 3 (early season)
    { season_id: 6, round: 3, player_id: 'P001', wins: 1, losses: 2, draws: 0, match_points: 30, rank: 5 },
    { season_id: 6, round: 3, player_id: 'P002', wins: 3, losses: 0, draws: 0, match_points: 90, rank: 1 },
    { season_id: 6, round: 3, player_id: 'P003', wins: 2, losses: 1, draws: 0, match_points: 60, rank: 3 },
    // Round 5 (mid-season)
    { season_id: 6, round: 5, player_id: 'P001', wins: 1, losses: 2, draws: 0, match_points: 30, rank: 5 },
    { season_id: 6, round: 5, player_id: 'P002', wins: 3, losses: 0, draws: 0, match_points: 90, rank: 1 },
    { season_id: 6, round: 5, player_id: 'P003', wins: 2, losses: 1, draws: 0, match_points: 60, rank: 3 },
    // Round 11 (final regular)
    { season_id: 6, round: 11, player_id: 'P001', wins: 3, losses: 0, draws: 0, match_points: 90, rank: 1 },
    { season_id: 6, round: 11, player_id: 'P002', wins: 2, losses: 1, draws: 0, match_points: 60, rank: 2 },
    { season_id: 6, round: 11, player_id: 'P003', wins: 1, losses: 2, draws: 0, match_points: 30, rank: 3 },
  ];
  t.melee_tournaments = [
    { melee_id: 100, season_id: 6, round: 3, name: 'SWU Wednesday league season 6 10/6 (week 3)', date: '2026-06-10', phase: 'regular' },
    { melee_id: 101, season_id: 6, round: 5, name: 'SWU Wednesday league season 6 24/6 (week 5)', date: '2026-06-24', phase: 'regular' },
    { melee_id: 102, season_id: 6, round: 11, name: 'SWU Wednesday league season 6 26/8 (week 11)', date: '2026-08-26', phase: 'regular' },
  ];
  return t;
}

describe('handleGetLeaderboardData', () => {
  let DB;
  let env;

  beforeEach(() => {
    installCryptoMock();
    const tables = leaderboardTables();
    DB = createMockDb(tables);
    env = { DB };
  });

  it('returns stored awards with resolved player names', async () => {
    const result = await handleGetLeaderboardData({ seasonId: 6 }, env);
    assert.ok(result.schemer);
    assert.ok(result.schemer.length > 0);
    const first = result.schemer[0];
    assert.ok(first.name);
    assert.ok(typeof first.score === 'string');
  });

  it('scores formatted as "X Pts", "X Leaders", "X Votes", "+X Climb"', async () => {
    const result = await handleGetLeaderboardData({ seasonId: 6 }, env);
    if (result.schemer && result.schemer.length > 0) {
      assert.ok(/\d+ Leaders/.test(result.schemer[0].score), `schemer score: ${result.schemer[0].score}`);
    }
    if (result.ambassador && result.ambassador.length > 0) {
      assert.ok(/\d+ Votes/.test(result.ambassador[0].score), `ambassador score: ${result.ambassador[0].score}`);
    }
    if (result.ruler && result.ruler.length > 0) {
      assert.ok(/\d+ Pts/.test(result.ruler[0].score), `ruler score: ${result.ruler[0].score}`);
    }
    if (result.newHope && result.newHope.length > 0) {
      assert.ok(/\+\d+ Climb/.test(result.newHope[0].score), `newHope score: ${result.newHope[0].score}`);
    }
  });

  it('empty leaderLeaderboard when no vote data', async () => {
    const db = createMockDb(emptyTables());
    const result = await handleGetLeaderboardData({ seasonId: 1 }, { DB: db });
    assert.ok(Array.isArray(result.leaderLeaderboard));
    assert.equal(result.leaderLeaderboard.length, 0);
  });

  it('returns participation data', async () => {
    const result = await handleGetLeaderboardData({ seasonId: 6 }, env);
    assert.ok(result.participation);
    assert.equal(typeof result.participation.participationPct, 'number');
    assert.equal(typeof result.participation.totalPlayers, 'number');
    assert.equal(typeof result.participation.playersWhoVoted, 'number');
  });

  it('no season specified falls back to active season', async () => {
    const result = await handleGetLeaderboardData({}, env);
    assert.ok(result.schemer);
    assert.ok(result.participation);
  });

  it('invalid season → 400', async () => {
    const tables = leaderboardTables();
    tables.settings = tables.settings.filter((s) => s.key !== 'ACTIVE_SEASON_ID');
    const db = createMockDb(tables);
    await assert.rejects(
      () => handleGetLeaderboardData({}, { DB: db }),
      (err) => {
        assert.equal(err.status, 400);
        return true;
      }
    );
  });

  it('live Schemer fallback when no stored award', async () => {
    const tables = tablesWithoutAwards();
    const db = createMockDb(tables);
    const result = await handleGetLeaderboardData({ seasonId: 6 }, { DB: db });
    assert.ok(result.schemer, 'schemer present from live compute');
    assert.ok(result.schemer.length > 0, 'schemer has entries');
    assert.ok(result.schemer[0].name);
    assert.ok(/\d+ Leaders/.test(result.schemer[0].score));
  });

  it('live Ambassador fallback when no stored award', async () => {
    const tables = tablesWithoutAwards();
    const db = createMockDb(tables);
    const result = await handleGetLeaderboardData({ seasonId: 6 }, { DB: db });
    assert.ok(result.ambassador, 'ambassador present from live compute');
    assert.ok(result.ambassador.length > 0, 'ambassador has entries');
    assert.ok(result.ambassador[0].name);
    assert.ok(/\d+ Votes/.test(result.ambassador[0].score));
  });

  it('live Ruler from season_standings when no stored award', async () => {
    const tables = tablesWithStandings();
    const db = createMockDb(tables);
    const result = await handleGetLeaderboardData({ seasonId: 6 }, { DB: db });
    assert.ok(result.ruler, 'ruler present from DB');
    assert.ok(result.ruler.length > 0, 'ruler has entries');
    assert.ok(result.ruler[0].name);
    assert.ok(/\d+ Pts/.test(result.ruler[0].score));
  });

  it('live New Hope from mid+final standings when no stored award', async () => {
    const tables = tablesWithStandings();
    tables.settings = tables.settings.map(s =>
      s.key === 'VOTING_OPEN' ? { ...s, value: 'FALSE' } : s
    ).map(s =>
      s.key === 'CURRENT_WEEK' ? { ...s, value: 'Season Ended' } : s
    );
    const db = createMockDb(tables);
    const result = await handleGetLeaderboardData({ seasonId: 6 }, { DB: db });
    assert.ok(result.newHope, 'newHope present from DB');
    assert.ok(result.newHope.length > 0, 'newHope has entries');
    assert.ok(result.newHope[0].name);
    assert.ok(/\+\d+ Climb/.test(result.newHope[0].score));
  });

  it('Bounty Hunter null when voting is live', async () => {
    const result = await handleGetLeaderboardData({ seasonId: 6 }, env);
    assert.equal(result.bountyHunter, null, 'bountyHunter hidden during live voting');
  });

  it('Bounty Hunter visible when voting closed', async () => {
    const tables = closedVotingTables();
    tables.settings = tables.settings.map(s =>
      s.key === 'ACTIVE_SEASON_ID' ? { ...s, value: '6' } : s
    );
    const db = createMockDb(tables);
    const result = await handleGetLeaderboardData({ seasonId: 6 }, { DB: db });
    assert.ok(result.bountyHunter, 'bountyHunter present when voting closed');
    assert.ok(result.bountyHunter.length > 0, 'bountyHunter has entries');
    assert.ok(result.bountyHunter[0].name);
  });

  it('Ambassador callsign masking when voting is live', async () => {
    const tables = tablesWithoutAwards();
    const db = createMockDb(tables);
    const result = await handleGetLeaderboardData({ seasonId: 6 }, { DB: db });
    if (result.ambassador && result.ambassador.length > 0) {
      const callsigns = ['Gold Leader', 'Green Leader', 'Red Leader', 'Blade Eleven', 'Rogue One', 'Phoenix Leader'];
      assert.ok(callsigns.includes(result.ambassador[0].name), `ambassador name "${result.ambassador[0].name}" is a callsign`);
    }
  });

  it('Ambassador real names when voting closed', async () => {
    const tables = closedVotingTables();
    tables.settings = tables.settings.map(s =>
      s.key === 'ACTIVE_SEASON_ID' ? { ...s, value: '6' } : s
    );
    const db = createMockDb(tables);
    const result = await handleGetLeaderboardData({ seasonId: 6 }, { DB: db });
    if (result.ambassador && result.ambassador.length > 0) {
      const callsigns = ['Gold Leader', 'Green Leader', 'Red Leader', 'Blade Eleven', 'Rogue One', 'Phoenix Leader'];
      assert.ok(!callsigns.includes(result.ambassador[0].name), `ambassador name "${result.ambassador[0].name}" is real, not a callsign`);
    }
  });

  it('no standings in DB → ruler and newHope null', async () => {
    const tables = tablesWithoutAwards();
    const db = createMockDb(tables);
    const result = await handleGetLeaderboardData({ seasonId: 6 }, { DB: db });
    assert.equal(result.ruler, null, 'ruler null when no standings');
    assert.equal(result.newHope, null, 'newHope null when no standings');
  });

  it('non-active season uses stored awards only, no live query', async () => {
    const tables = tablesWithoutAwards();
    tables.awards = [
      { season_id: 5, award_name: 'Galactic Ruler', player_id: 'P001', score: 55 },
    ];
    const db = createMockDb(tables);
    const result = await handleGetLeaderboardData({ seasonId: 5 }, { DB: db });
    assert.ok(result.ruler, 'ruler from stored award');
    assert.equal(result.ruler.length, 1);
  });

  it('resolveNames falls back to raw playerId when not in nameMap', async () => {
    const tables = tablesWithoutAwards();
    tables.awards = [
      { season_id: 6, award_name: 'Galactic Schemer', player_id: 'P_NONEXISTENT', score: 5 },
    ];
    const db = createMockDb(tables);
    const result = await handleGetLeaderboardData({ seasonId: 6 }, { DB: db });
    assert.ok(result.schemer);
    assert.equal(result.schemer[0].name, 'P_NONEXISTENT', 'falls back to raw playerId when not in nameMap');
  });

  it('score format strings match expected patterns', async () => {
    const result = await handleGetLeaderboardData({ seasonId: 6 }, env);
    if (result.schemer && result.schemer.length > 0) {
      assert.ok(/^\d+ Leaders$/.test(result.schemer[0].score), `schemer exact format: ${result.schemer[0].score}`);
    }
    if (result.ambassador && result.ambassador.length > 0) {
      assert.ok(/^\d+ Votes$/.test(result.ambassador[0].score), `ambassador exact format: ${result.ambassador[0].score}`);
    }
    if (result.ruler && result.ruler.length > 0) {
      assert.ok(/^\d+ Pts$/.test(result.ruler[0].score), `ruler exact format: ${result.ruler[0].score}`);
    }
    if (result.newHope && result.newHope.length > 0) {
      assert.ok(/^\+\d+ Climb$/.test(result.newHope[0].score), `newHope exact format: ${result.newHope[0].score}`);
    }
    if (result.bountyHunter && result.bountyHunter.length > 0) {
      assert.ok(/^\d+ .*$/.test(result.bountyHunter[0].score), `bountyHunter format: ${result.bountyHunter[0].score}`);
    }
  });

  it('response includes seasonId, seasonName, isActiveSeason', async () => {
    const result = await handleGetLeaderboardData({ seasonId: 6 }, env);
    assert.equal(result.seasonId, 6);
    assert.equal(typeof result.seasonName, 'string');
    assert.equal(typeof result.isActiveSeason, 'boolean');
  });

  it('isActiveSeason true when requesting active season', async () => {
    const result = await handleGetLeaderboardData({ seasonId: 6 }, env);
    assert.equal(result.isActiveSeason, true);
  });

  it('isActiveSeason false when requesting historical season', async () => {
    const result = await handleGetLeaderboardData({ seasonId: 5 }, env);
    assert.equal(result.isActiveSeason, false);
  });
});
