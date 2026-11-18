export function nightKey(seasonId, round) {
  return `${seasonId}-${round}`;
}

export function playedCount(night) {
  return (night.wins || 0) + (night.draws || 0) + (night.losses || 0);
}

export function buildRoundCountByNight(rows, keyFn = r => nightKey(r.season_id, r.round)) {
  const tallies = new Map();
  for (const row of rows) {
    const played = playedCount(row);
    if (played <= 0) continue;
    const key = keyFn(row);
    let freq = tallies.get(key);
    if (!freq) {
      freq = new Map();
      tallies.set(key, freq);
    }
    freq.set(played, (freq.get(played) || 0) + 1);
  }

  const counts = new Map();
  for (const [key, freq] of tallies) {
    let best = 0;
    let bestCount = -1;
    for (const [played, n] of freq) {
      if (n > bestCount || (n === bestCount && played > best)) {
        best = played;
        bestCount = n;
      }
    }
    counts.set(key, best);
  }
  return counts;
}

export function isUndefeatedNight(night, roundCount) {
  if (!roundCount) return false;
  return (night.wins || 0) === roundCount &&
    (night.draws || 0) === 0 &&
    (night.losses || 0) === 0;
}

export function isLosslessNight(night, roundCount) {
  if (!roundCount) return false;
  return (night.losses || 0) === 0 && playedCount(night) === roundCount;
}
