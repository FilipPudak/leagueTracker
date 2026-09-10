import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseMatchResult, buildRivalry, buildCareerRecord, buildSeasonProgression } from '../../src/lib/careerStats.js';

function matchRow(p1, p2, winner, result, extra = {}) {
  return { season_id: 6, round: 1, player1_id: p1, player2_id: p2, winner_id: winner, result, is_bye: 0, ...extra };
}

describe('lib/careerStats parseMatchResult', () => {
  it('parses win strings', () => {
    assert.deepEqual(parseMatchResult('Ade70 won 2-1-0'), { gamesWinner: 2, gamesLoser: 1 });
    assert.deepEqual(parseMatchResult('Filip Pudak won 2-0-0'), { gamesWinner: 2, gamesLoser: 0 });
  });

  it('parses draw strings', () => {
    assert.deepEqual(parseMatchResult('1-1-0 Draw'), { gamesWinner: 1, gamesLoser: 1 });
  });

  it('returns null for null, empty, or garbage', () => {
    assert.equal(parseMatchResult(null), null);
    assert.equal(parseMatchResult(''), null);
    assert.equal(parseMatchResult('forfeit'), null);
    assert.equal(parseMatchResult(42), null);
  });
});

describe('lib/careerStats buildRivalry', () => {
  const names = new Map([['P002', 'Bob'], ['P003', 'Carol'], ['P004', 'Dana']]);

  it('nemesis = opponent with most losses vs me; victim = most wins by me', () => {
    const matches = [
      matchRow('P001', 'P002', 'P002', 'Bob won 2-0-0'),
      matchRow('P001', 'P002', 'P002', 'Bob won 2-1-0'),
      matchRow('P001', 'P003', 'P001', 'Alice won 2-0-0'),
      matchRow('P001', 'P003', 'P001', 'Alice won 2-1-0'),
      matchRow('P001', 'P003', 'P003', 'Carol won 2-0-0'),
    ];
    const r = buildRivalry(matches, 'P001', names);
    assert.deepEqual(r.nemesis, [{ playerId: 'P002', name: 'Bob', meetings: 2, count: 2 }]);
    assert.deepEqual(r.victim, [{ playerId: 'P003', name: 'Carol', meetings: 3, count: 2 }]);
  });

  it('requires the minimum-meetings bar', () => {
    const matches = [matchRow('P001', 'P004', 'P004', null)];
    const r = buildRivalry(matches, 'P001', names);
    assert.deepEqual(r.nemesis, []);
    assert.equal(r.headToHead.length, 1, 'head-to-head list still shows single meetings');
  });

  it('byes never count as a win against a person', () => {
    const matches = [
      { season_id: 6, round: 1, player1_id: 'P001', player2_id: null, winner_id: 'P001', result: null, is_bye: 1 },
      { season_id: 6, round: 2, player1_id: 'P001', player2_id: 'P002', winner_id: 'P002', result: null, is_bye: 0 },
    ];
    const r = buildRivalry(matches, 'P001', names);
    assert.equal(r.headToHead.length, 1, 'bye excluded');
    assert.equal(r.headToHead[0].played, 1);
    assert.equal(r.headToHead[0].losses, 1);
  });

  it('ties share: same count and meetings → co-holders; more meetings breaks the tie', () => {
    const matches = [
      matchRow('P001', 'P002', 'P002', null),
      matchRow('P001', 'P002', 'P002', null),
      matchRow('P001', 'P003', 'P003', null),
      matchRow('P001', 'P003', 'P003', null),
      matchRow('P001', 'P003', 'P001', null),
    ];
    const r = buildRivalry(matches, 'P001', names);
    assert.deepEqual(r.nemesis.map(n => n.playerId), ['P003'], 'more meetings breaks tie → Bob had 2L/2M, Carol 2L/3M, most meetings wins');
  });

  it('draws count neither as win nor loss', () => {
    const matches = [
      matchRow('P001', 'P002', null, '1-1-0 Draw'),
      matchRow('P001', 'P002', null, '1-1-0 Draw'),
    ];
    const r = buildRivalry(matches, 'P001', names);
    assert.deepEqual(r.nemesis, []);
    assert.deepEqual(r.victim, []);
    assert.equal(r.headToHead[0].draws, 2);
  });

  it('falls back to player id when name unknown', () => {
    const matches = [matchRow('P001', 'P999', 'P001', null), matchRow('P001', 'P999', 'P001', null)];
    const r = buildRivalry(matches, 'P001', names);
    assert.equal(r.victim[0].name, 'P999');
  });
});

describe('lib/careerStats buildCareerRecord', () => {
  it('aggregates nights across seasons and matches from the player perspective', () => {
    const standings = [
      { season_id: 5, round: 1, player_id: 'P001', wins: 3, losses: 0, draws: 0 },
      { season_id: 6, round: 1, player_id: 'P001', wins: 2, losses: 1, draws: 0 },
      { season_id: 6, round: 1, player_id: 'P002', wins: 1, losses: 2, draws: 0 },
    ];
    const matches = [
      { season_id: 5, round: 1, player1_id: 'P001', player2_id: 'P002', winner_id: 'P001', result: 'P1 won 2-0-0', is_bye: 0 },
      { season_id: 6, round: 1, player1_id: 'P002', player2_id: 'P001', winner_id: 'P002', result: 'P2 won 2-1-0', is_bye: 0 },
      { season_id: 6, round: 1, player1_id: 'P002', player2_id: 'P001', winner_id: 'P002', result: 'P2 won 2-0-0', is_bye: 0 },
      { season_id: 6, round: 2, player1_id: 'P001', player2_id: 'P002', winner_id: null, result: '1-1-0 Draw', is_bye: 0 },
      { season_id: 6, round: 3, player1_id: 'P001', player2_id: null, winner_id: 'P001', result: null, is_bye: 1 },
    ];
    const rec = buildCareerRecord(standings, matches, 'P001');
    assert.equal(rec.nights, 2);
    assert.equal(rec.sinceSeason, 5);
    assert.equal(rec.matches.played, 4);
    assert.equal(rec.matches.wins, 1);
    assert.equal(rec.matches.losses, 2);
    assert.equal(rec.matches.draws, 1);
    assert.equal(rec.matches.byes, undefined);
    assert.equal(rec.games.won, 4);
    assert.equal(rec.games.lost, 5);
    assert.equal(rec.games.parsed, 4);
    assert.equal(rec.sweeps.count, 1);
    assert.equal(rec.deciders, undefined);
    assert.equal(rec.winPct, 25);
    assert.equal(rec.undefeated, 1);
    assert.equal(rec.gameDiff, -1);
    assert.equal(rec.avgPtsPerNight, 7.5);
  });

  it('unparsable results still count the match outcome, not games', () => {
    const matches = [matchRow('P001', 'P002', 'P001', 'retirement')];
    const rec = buildCareerRecord([], matches, 'P001');
    assert.equal(rec.matches.wins, 1);
    assert.equal(rec.games.won, 0);
    assert.equal(rec.games.parsed, 0);
  });

  it('empty career yields nulls and zeros', () => {
    const rec = buildCareerRecord([], [], 'P001');
    assert.equal(rec.sinceSeason, null);
    assert.equal(rec.nights, 0);
    assert.equal(rec.matches.played, 0);
    assert.equal(rec.winPct, null);
    assert.equal(rec.undefeated, 0);
    assert.equal(rec.gameDiff, 0);
    assert.equal(rec.avgPtsPerNight, 0);
  });
});

describe('lib/careerStats buildSeasonProgression', () => {
  const seasons = [
    { id: 5, name: 'Season 5', length: 11, top_results: 7 },
    { id: 6, name: 'Season 6', length: 11, top_results: 7 },
    { id: 7, name: 'Season 7', length: 11, top_results: 7 },
  ];

  it('derives rank from the full field per season, skips seasons without data, finds peak', () => {
    const allStandings = [
      { season_id: 5, round: 1, player_id: 'P001', wins: 1, losses: 2, draws: 0, rank: 3 },
      { season_id: 5, round: 1, player_id: 'P002', wins: 3, losses: 0, draws: 0, rank: 1 },
      { season_id: 6, round: 1, player_id: 'P001', wins: 3, losses: 0, draws: 0, rank: 1 },
      { season_id: 6, round: 1, player_id: 'P002', wins: 1, losses: 2, draws: 0, rank: 2 },
    ];
    const regularRoundsBySeason = new Map([
      [5, new Set([1])],
      [6, new Set([1, 2])],
      [7, new Set([1])],
    ]);

    const { progression, peak } = buildSeasonProgression({
      seasons, allStandings, regularRoundsBySeason, playerId: 'P001', activeSeasonId: 7,
    });

    assert.equal(progression.length, 3);
    assert.equal(progression[0].rank, 2, 'S5: P001 behind P002');
    assert.equal(progression[1].rank, 1, 'S6: P001 first');
    assert.equal(progression[2].rank, null, 'S7: no data');
    assert.equal(progression[2].isCurrent, true);
    assert.deepEqual(peak, { rank: 1, seasonId: 6 });
  });

  it('excludes cut/side rounds from the derived rank', () => {
    const allStandings = [
      { season_id: 6, round: 1, player_id: 'P001', wins: 0, losses: 3, draws: 0, rank: 4 },
      { season_id: 6, round: 1, player_id: 'P002', wins: 3, losses: 0, draws: 0, rank: 1 },
      { season_id: 6, round: 12, player_id: 'P002', wins: 0, losses: 3, draws: 0, rank: 8 },
    ];
    const regularRoundsBySeason = new Map([[6, new Set([1])]]);
    const { progression } = buildSeasonProgression({
      seasons: [seasons[1]], allStandings, regularRoundsBySeason, playerId: 'P001', activeSeasonId: 6,
    });
    assert.equal(progression[0].rank, 2, 'P001 last of 2 regulars; round-12 cut row ignored entirely');
    assert.equal(progression[0].fieldSize, 2);
  });

  it('best-X matters: player with worse top-1 but more good nights outranks on the derived table', () => {
    const nights = [];
    for (let r = 1; r <= 3; r++) {
      nights.push({ season_id: 6, round: r, player_id: 'P001', wins: 2, losses: 1, draws: 0, rank: r });
    }
    nights.push({ season_id: 6, round: 1, player_id: 'P002', wins: 6, losses: 0, draws: 0, rank: 1 });
    nights.push({ season_id: 6, round: 2, player_id: 'P002', wins: 0, losses: 6, draws: 0, rank: 9 });
    const regularRoundsBySeason = new Map([[6, new Set([1, 2, 3])]]);
    const { progression } = buildSeasonProgression({
      seasons: [{ id: 6, name: 'Season 6', length: 11, top_results: 1 }],
      allStandings: nights, regularRoundsBySeason, playerId: 'P001', activeSeasonId: 6,
    });
    assert.equal(progression[0].rank, 2, 'top_results=1: P002 keeps best night (18 pts) vs P001 (6)');
  });
});
