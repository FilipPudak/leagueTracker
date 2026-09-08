export function nightPoints(s) {
  return 3 * (s.wins || 0) + (s.draws || 0);
}

export function computeSeasonTable(entries, topResults) {
  const playerMap = new Map();

  for (const entry of entries) {
    const pid = entry.playerId;
    if (!playerMap.has(pid)) {
      playerMap.set(pid, { nights: [], playerId: pid });
    }
    playerMap.get(pid).nights.push(entry);
  }

  const rows = [];
  for (const [playerId, data] of playerMap) {
    const sorted = [...data.nights].sort((a, b) => {
      const pa = nightPoints(a), pb = nightPoints(b);
      if (pb !== pa) return pb - pa;
      return a.round - b.round;
    });
    const best = sorted.slice(0, topResults);

    const played = best.reduce((s, n) => s + (n.wins || 0) + (n.draws || 0) + (n.losses || 0), 0);
    const won = best.reduce((s, n) => s + (n.wins || 0), 0);
    const drawn = best.reduce((s, n) => s + (n.draws || 0), 0);
    const lost = best.reduce((s, n) => s + (n.losses || 0), 0);
    const points = best.reduce((s, n) => s + nightPoints(n), 0);
    const undefeatedNights = best.filter(n => (n.losses || 0) === 0).length;
    const nightRankSum = best.reduce((s, n) => s + (n.rank || 0), 0);

    rows.push({ playerId, rounds: best, played, won, drawn, lost, points, undefeatedNights, nightRankSum });
  }

  rows.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.undefeatedNights !== a.undefeatedNights) return b.undefeatedNights - a.undefeatedNights;
    if (a.nightRankSum !== b.nightRankSum) return a.nightRankSum - b.nightRankSum;
    return a.playerId.localeCompare(b.playerId);
  });

  for (let i = 0; i < rows.length; i++) {
    if (i > 0 &&
      rows[i].points === rows[i - 1].points &&
      rows[i].undefeatedNights === rows[i - 1].undefeatedNights &&
      rows[i].nightRankSum === rows[i - 1].nightRankSum) {
      rows[i].rank = rows[i - 1].rank;
    } else {
      rows[i].rank = i + 1;
    }
  }

  return rows;
}
