import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { nightKey, playedCount, buildRoundCountByNight, isUndefeatedNight, isLosslessNight } from '../../src/lib/nights.js';

describe('lib/nights', () => {
  it('builds the round count per season round from the modal field count', () => {
    const rows = [
      { season_id: 6, round: 1, wins: 4, draws: 0, losses: 0 },
      { season_id: 6, round: 1, wins: 2, draws: 1, losses: 1 },
      { season_id: 6, round: 2, wins: 3, draws: 0, losses: 0 },
      { season_id: 5, round: 1, wins: 5, draws: 0, losses: 1 },
    ];
    const counts = buildRoundCountByNight(rows);
    assert.equal(counts.get(nightKey(6, 1)), 4);
    assert.equal(counts.get(nightKey(6, 2)), 3);
    assert.equal(counts.get(nightKey(5, 1)), 6);
  });

  it('ignores an over-counting outlier so it cannot zero the night', () => {
    const rows = [
      { season_id: 6, round: 1, wins: 4, draws: 0, losses: 0 },
      { season_id: 6, round: 1, wins: 3, draws: 1, losses: 0 },
      { season_id: 6, round: 1, wins: 2, draws: 0, losses: 2 },
      { season_id: 6, round: 1, wins: 5, draws: 0, losses: 0 },
    ];
    assert.equal(buildRoundCountByNight(rows).get(nightKey(6, 1)), 4);
  });

  it('breaks a modal tie toward the larger count', () => {
    const rows = [
      { season_id: 6, round: 1, wins: 4, draws: 0, losses: 0 },
      { season_id: 6, round: 1, wins: 0, draws: 0, losses: 3 },
    ];
    assert.equal(buildRoundCountByNight(rows).get(nightKey(6, 1)), 4);
  });

  it('skips rows with no games played', () => {
    const rows = [
      { season_id: 6, round: 1, wins: 0, draws: 0, losses: 0 },
      { season_id: 6, round: 1, wins: 3, draws: 0, losses: 1 },
    ];
    assert.equal(buildRoundCountByNight(rows).get(nightKey(6, 1)), 4);
    assert.equal(buildRoundCountByNight([{ season_id: 6, round: 2, wins: 0, draws: 0, losses: 0 }]).size, 0);
  });

  it('supports a custom key function', () => {
    const counts = buildRoundCountByNight(
      [{ round: 1, wins: 3, draws: 1, losses: 0 }],
      n => String(n.round)
    );
    assert.equal(counts.get('1'), 4);
  });

  it('counts draws and losses as games played', () => {
    assert.equal(playedCount({ wins: 2, draws: 1, losses: 1 }), 4);
    assert.equal(playedCount({}), 0);
  });

  it('requires a full night won outright for undefeated', () => {
    assert.equal(isUndefeatedNight({ wins: 4, draws: 0, losses: 0 }, 4), true);
    assert.equal(isUndefeatedNight({ wins: 3, draws: 1, losses: 0 }, 4), false);
    assert.equal(isUndefeatedNight({ wins: 2, draws: 0, losses: 0 }, 4), false);
    assert.equal(isUndefeatedNight({ wins: 0, draws: 0, losses: 0 }, 0), false);
    assert.equal(isUndefeatedNight({ wins: 4, draws: 0, losses: 0 }, undefined), false);
  });

  it('allows draws but requires a full night for lossless', () => {
    assert.equal(isLosslessNight({ wins: 4, draws: 0, losses: 0 }, 4), true);
    assert.equal(isLosslessNight({ wins: 3, draws: 1, losses: 0 }, 4), true);
    assert.equal(isLosslessNight({ wins: 3, draws: 0, losses: 0 }, 4), false);
    assert.equal(isLosslessNight({ wins: 0, draws: 0, losses: 0 }, 0), false);
    assert.equal(isLosslessNight({ wins: 4, draws: 0, losses: 0 }, undefined), false);
  });
});
