import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlayerSeasonSection } from '../../src/lib/playerSeason.js';

function standing(seasonId, round, playerId, wins, draws, losses, rank) {
  return { season_id: seasonId, round, player_id: playerId, wins, draws, losses, rank };
}

function tournament(seasonId, round, phase) {
  return { season_id: seasonId, round, phase };
}

function build(overrides = {}) {
  return buildPlayerSeasonSection({
    playerId: 'P001',
    seasonStandings: [],
    tournaments: [],
    attendanceCount: 0,
    totalNights: 0,
    topResults: 7,
    ...overrides,
  });
}

describe('lib/playerSeason buildPlayerSeasonSection', () => {
  it('no standings → rank null, points 0, empty nights, zero W-D-L', () => {
    const season = build();
    assert.equal(season.rank, null);
    assert.equal(season.points, 0);
    assert.deepEqual(season.nights, []);
    assert.equal(season.played, 0);
    assert.equal(season.won, 0);
    assert.equal(season.drawn, 0);
    assert.equal(season.lost, 0);
    assert.deepEqual(season.leaders, []);
    assert.deepEqual(season.awards, []);
  });

  it('excludes cut/side rounds from rank, points and the night list', () => {
    const season = build({
      seasonStandings: [
        standing(6, 1, 'P001', 3, 0, 0, 1),
        standing(6, 1, 'P002', 1, 0, 2, 2),
        standing(6, 2, 'P001', 2, 1, 0, 1),
        standing(6, 2, 'P002', 1, 2, 0, 2),
        standing(6, 3, 'P001', 3, 0, 0, 1),
        standing(6, 3, 'P002', 0, 0, 3, 2),
      ],
      tournaments: [
        tournament(6, 1, 'regular'),
        tournament(6, 2, 'regular'),
        tournament(6, 3, 'cut'),
      ],
    });
    assert.deepEqual(season.nights.map(n => n.round), [1, 2], 'cut night must not appear');
    assert.equal(season.rank, 1);
    assert.equal(season.points, 16, '9 + 7 only; the cut night is not counted');
    assert.equal(season.played, 6);
  });

  it('uses only the best top_results nights for rank/points/W-D-L', () => {
    const seasonStandings = [];
    const tournaments = [];
    const wins = [3, 3, 3, 3, 3, 3, 3, 0];
    for (let i = 0; i < wins.length; i++) {
      const round = i + 1;
      tournaments.push(tournament(6, round, 'regular'));
      seasonStandings.push(standing(6, round, 'P001', wins[i], 0, 3 - wins[i], 1));
      seasonStandings.push(standing(6, round, 'P002', 1, 0, 2, 2));
    }
    const season = build({ seasonStandings, tournaments, topResults: 7 });
    assert.equal(season.points, 63, 'top 7 of 8 nights (7×9 + dropped 0)');
    assert.equal(season.played, 21);
    assert.equal(season.won, 21);
    assert.equal(season.lost, 0);
    assert.equal(season.nights.length, 8, 'the night list shows every regular night, not just the best seven');
  });

  it('falls back to the 7-night default when top_results is missing', () => {
    const seasonStandings = [];
    const tournaments = [];
    for (let round = 1; round <= 8; round++) {
      tournaments.push(tournament(6, round, 'regular'));
      seasonStandings.push(standing(6, round, 'P001', round === 8 ? 0 : 3, 0, round === 8 ? 3 : 0, 1));
      seasonStandings.push(standing(6, round, 'P002', 1, 0, 2, 2));
    }
    const season = build({ seasonStandings, tournaments, topResults: undefined });
    assert.equal(season.points, 63, 'DEFAULT_TOP_RESULTS = 7 applies when the season row has no top_results');
  });

  it('nights are returned ascending by round (display sorts a copy)', () => {
    const season = build({
      seasonStandings: [
        standing(6, 3, 'P001', 1, 0, 2, 3),
        standing(6, 1, 'P001', 3, 0, 0, 1),
        standing(6, 2, 'P001', 2, 1, 0, 2),
      ],
      tournaments: [tournament(6, 1, 'regular'), tournament(6, 2, 'regular'), tournament(6, 3, 'regular')],
    });
    assert.deepEqual(season.nights.map(n => n.round), [1, 2, 3]);
    assert.deepEqual(season.nights[1], { round: 2, wins: 2, draws: 1, losses: 0, points: 7, rank: 2 });
  });

  it('nightsAttended comes from attendance, totalNights from regular tournaments', () => {
    const season = build({ attendanceCount: 3, totalNights: 11 });
    assert.equal(season.nightsAttended, 3);
    assert.equal(season.totalNights, 11, 'partial Melee data may disagree with the night list — inherited');
  });

  it('W-D-L and played are internally consistent (one match per game)', () => {
    const season = build({
      seasonStandings: [
        standing(6, 1, 'P001', 3, 0, 0, 1),
        standing(6, 1, 'P002', 0, 0, 3, 2),
        standing(6, 2, 'P001', 1, 1, 1, 2),
        standing(6, 2, 'P002', 1, 1, 1, 1),
      ],
      tournaments: [tournament(6, 1, 'regular'), tournament(6, 2, 'regular')],
    });
    assert.equal(season.won, 4);
    assert.equal(season.drawn, 1);
    assert.equal(season.lost, 1);
    assert.equal(season.played, season.won + season.drawn + season.lost);
    assert.equal(season.points, season.won * 3 + season.drawn);
  });

  it('passes through preloaded leaders and awards unchanged', () => {
    const leaders = [{ id: '1', plays: 2, wins: 1, losses: 1, draws: 0, winPct: 50 }];
    const awards = [{ award_name: 'Galactic Ruler', score: 67 }];
    const season = build({ leaders, awards });
    assert.equal(season.leaders, leaders);
    assert.equal(season.awards, awards);
  });
});
