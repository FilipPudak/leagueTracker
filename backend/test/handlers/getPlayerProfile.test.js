import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMockDb } from '../helpers/mock-db.js';
import { basicTables } from '../helpers/fixtures.js';
import { handleGetPlayerProfile } from '../../src/handlers/getPlayerProfile.js';

function makeTables(overrides = {}) {
  const t = basicTables();
  if (overrides.settings) t.settings = overrides.settings;
  if (overrides.seasons) t.seasons = overrides.seasons;
  if (overrides.season_standings) t.season_standings = overrides.season_standings;
  if (overrides.melee_tournaments) t.melee_tournaments = overrides.melee_tournaments;
  if (overrides.match_results) t.match_results = overrides.match_results;
  if (overrides.attendance) t.attendance = overrides.attendance;
  if (overrides.votes) t.votes = overrides.votes;
  if (overrides.awards) t.awards = overrides.awards;
  if (overrides.players) t.players = overrides.players;
  return t;
}

describe('handleGetPlayerProfile', () => {
  let env;

  beforeEach(() => {
    env = { DB: createMockDb(makeTables()) };
  });

  it('rejects missing playerId with 400', async () => {
    await assert.rejects(
      () => handleGetPlayerProfile({}, env),
      (err) => {
        assert.equal(err.status, 400);
        assert.match(err.message, /playerId is required/);
        return true;
      }
    );
  });

  it('rejects non-existent player with 404', async () => {
    await assert.rejects(
      () => handleGetPlayerProfile({ playerId: 'P999' }, env),
      (err) => {
        assert.equal(err.status, 404);
        assert.match(err.message, /Player not found/);
        return true;
      }
    );
  });

  it('rejects invalid seasonId with 400', async () => {
    await assert.rejects(
      () => handleGetPlayerProfile({ playerId: 'P001', seasonId: 'banana' }, env),
      (err) => {
        assert.equal(err.status, 400);
        assert.match(err.message, /Invalid seasonId/);
        return true;
      }
    );
  });

  it('returns correct response shape for player with season data', async () => {
    const tables = makeTables({
      melee_tournaments: [
        { melee_id: 100, season_id: 6, round: 1, name: 'week 1', date: '2026-06-15', phase: 'regular' },
        { melee_id: 101, season_id: 6, round: 2, name: 'week 2', date: '2026-06-22', phase: 'regular' },
      ],
      season_standings: [
        { season_id: 6, round: 1, player_id: 'P001', wins: 3, losses: 0, draws: 0, match_points: 9, rank: 1 },
        { season_id: 6, round: 1, player_id: 'P002', wins: 2, losses: 1, draws: 0, match_points: 6, rank: 2 },
        { season_id: 6, round: 2, player_id: 'P001', wins: 2, losses: 1, draws: 0, match_points: 6, rank: 2 },
        { season_id: 6, round: 2, player_id: 'P002', wins: 3, losses: 0, draws: 0, match_points: 9, rank: 1 },
      ],
      match_results: [
        { season_id: 6, round: 1, melee_match_id: 'm1', player1_id: 'P001', player2_id: 'P002', winner_id: 'P001', result: 'Alice won 2-1-0', is_bye: 0 },
      ],
      attendance: [
        { season_id: 6, week: 1, player_id: 'P001' },
        { season_id: 6, week: 2, player_id: 'P001' },
      ],
    });
    env = { DB: createMockDb(tables) };

    const result = await handleGetPlayerProfile({ playerId: 'P001', seasonId: 6 }, env);

    assert.equal(result.playerId, 'P001');
    assert.equal(result.playerName, 'Alice');
    assert.ok(result.season);
    assert.ok(result.career);
    assert.equal(typeof result.season.rank, 'number');
    assert.equal(result.season.nightsAttended, 2);
    assert.ok(Array.isArray(result.season.nights));
    assert.ok(Array.isArray(result.season.leaders));
    assert.ok(Array.isArray(result.season.awards));
    assert.ok(Array.isArray(result.career.badges));
    assert.ok(Array.isArray(result.career.progression));
  });

  it('computes season rank via season table', async () => {
    const tables = makeTables({
      melee_tournaments: [
        { melee_id: 100, season_id: 6, round: 1, name: 'week 1', date: '2026-06-15', phase: 'regular' },
      ],
      season_standings: [
        { season_id: 6, round: 1, player_id: 'P001', wins: 3, losses: 0, draws: 0, match_points: 9, rank: 1 },
        { season_id: 6, round: 1, player_id: 'P002', wins: 1, losses: 2, draws: 0, match_points: 3, rank: 2 },
      ],
    });
    env = { DB: createMockDb(tables) };

    const result = await handleGetPlayerProfile({ playerId: 'P001', seasonId: 6 }, env);

    assert.equal(result.season.rank, 1);
    assert.equal(result.season.points, 9);
  });

  it('returns null rank for player with no season standings', async () => {
    const tables = makeTables({
      melee_tournaments: [
        { melee_id: 100, season_id: 6, round: 1, name: 'week 1', date: '2026-06-15', phase: 'regular' },
      ],
      season_standings: [
        { season_id: 6, round: 1, player_id: 'P002', wins: 3, losses: 0, draws: 0, match_points: 9, rank: 1 },
      ],
    });
    env = { DB: createMockDb(tables) };

    const result = await handleGetPlayerProfile({ playerId: 'P001', seasonId: 6 }, env);

    assert.equal(result.season.rank, null);
    assert.equal(result.season.points, 0);
    assert.equal(result.season.won, 0);
  });

  it('returns awards only for closed seasons', async () => {
    const result = await handleGetPlayerProfile({ playerId: 'P001', seasonId: 6 }, env);
    assert.deepEqual(result.season.awards, []);
  });

  it('returns awards for closed seasons', async () => {
    const tables = makeTables({
      settings: [
        { key: 'ACTIVE_SEASON_ID', value: '7' },
        { key: 'CURRENT_WEEK', value: 'Week 3' },
        { key: 'VOTING_OPEN', value: 'TRUE' },
      ],
      seasons: [
        { id: 7, name: 'Season 7', created_date: '2026-09-01', length: 11, top_results: 7 },
        { id: 6, name: 'Season 6', created_date: '2026-06-03', length: 11, top_results: 7 },
      ],
    });
    env = { DB: createMockDb(tables) };

    const result = await handleGetPlayerProfile({ playerId: 'P001', seasonId: 6 }, env);

    assert.ok(result.season.awards.length > 0);
    assert.ok(result.season.awards.some(a => a.award_name === 'Galactic Ruler'));
  });

  it('falls back to active season when no seasonId', async () => {
    const tables = makeTables({
      melee_tournaments: [
        { melee_id: 100, season_id: 6, round: 1, name: 'week 1', date: '2026-06-15', phase: 'regular' },
      ],
      season_standings: [
        { season_id: 6, round: 1, player_id: 'P001', wins: 3, losses: 0, draws: 0, match_points: 9, rank: 1 },
      ],
    });
    env = { DB: createMockDb(tables) };

    const result = await handleGetPlayerProfile({ playerId: 'P001' }, env);

    assert.equal(result.season.rank, 1);
  });

  it('accepts "S6" format seasonId', async () => {
    const result = await handleGetPlayerProfile({ playerId: 'P001', seasonId: 'S6' }, env);
    assert.ok(result.season);
  });

  it('returns career data across seasons', async () => {
    const tables = makeTables({
      seasons: [
        { id: 6, name: 'Season 6', created_date: '2026-06-03', length: 11, top_results: 7 },
        { id: 5, name: 'Season 5', created_date: '2026-01-15', length: 11, top_results: 7 },
      ],
      melee_tournaments: [
        { melee_id: 100, season_id: 6, round: 1, name: 'week 1', date: '2026-06-15', phase: 'regular' },
        { melee_id: 101, season_id: 5, round: 1, name: 'week 1', date: '2026-02-01', phase: 'regular' },
      ],
      season_standings: [
        { season_id: 6, round: 1, player_id: 'P001', wins: 3, losses: 0, draws: 0, match_points: 9, rank: 1 },
        { season_id: 5, round: 1, player_id: 'P001', wins: 2, losses: 1, draws: 0, match_points: 6, rank: 2 },
      ],
      match_results: [
        { season_id: 6, round: 1, melee_match_id: 'm1', player1_id: 'P001', player2_id: 'P002', winner_id: 'P001', result: 'Alice won 2-0-0', is_bye: 0 },
        { season_id: 5, round: 1, melee_match_id: 'm2', player1_id: 'P001', player2_id: 'P002', winner_id: 'P001', result: 'Alice won 2-1-0', is_bye: 0 },
      ],
    });
    env = { DB: createMockDb(tables) };

    const result = await handleGetPlayerProfile({ playerId: 'P001', seasonId: 6 }, env);

    assert.ok(result.career.nightsPlayed >= 2);
    assert.ok(result.career.progression.length >= 2);
    assert.equal(result.career.totalWDLL.won, 2);
  });

  it('returns only earned badges', async () => {
    const tables = makeTables({
      melee_tournaments: [
        { melee_id: 100, season_id: 6, round: 1, name: 'week 1', date: '2026-06-15', phase: 'regular' },
      ],
      season_standings: [
        { season_id: 6, round: 1, player_id: 'P001', wins: 3, losses: 0, draws: 0, match_points: 9, rank: 1 },
      ],
      attendance: [
        { season_id: 6, week: 1, player_id: 'P001' },
      ],
    });
    env = { DB: createMockDb(tables) };

    const result = await handleGetPlayerProfile({ playerId: 'P001', seasonId: 6 }, env);

    assert.ok(Array.isArray(result.career.badges));
    for (const badge of result.career.badges) {
      assert.equal(badge.earned, true);
    }
  });

  it('returns leaders with expected structure', async () => {
    const tables = makeTables({
      melee_tournaments: [
        { melee_id: 100, season_id: 6, round: 1, name: 'week 1', date: '2026-06-15', phase: 'regular' },
      ],
      season_standings: [
        { season_id: 6, round: 1, player_id: 'P001', wins: 3, losses: 0, draws: 0, match_points: 9, rank: 1 },
      ],
      votes: [
        { id: 1, timestamp: '2026-06-15T18:00:00Z', updated_at: null, season_id: 6, week: 1, player_id: 'P001', leader_id: '1', opponent_id: 'P002' },
      ],
      match_results: [
        { season_id: 6, round: 1, melee_match_id: 'm1', player1_id: 'P001', player2_id: 'P002', winner_id: 'P001', result: 'Alice won 2-0-0', is_bye: 0 },
      ],
    });
    env = { DB: createMockDb(tables) };

    const result = await handleGetPlayerProfile({ playerId: 'P001', seasonId: 6 }, env);

    assert.ok(result.season.leaders.length > 0);
    const leader = result.season.leaders[0];
    assert.equal(leader.plays, 1);
    assert.ok(typeof leader.wins === 'number');
    assert.ok(typeof leader.losses === 'number');
    assert.ok(typeof leader.draws === 'number');
  });

  it('works without auth (public endpoint)', async () => {
    const result = await handleGetPlayerProfile({ playerId: 'P001', seasonId: 6 }, env);
    assert.equal(result.playerId, 'P001');
  });
});
