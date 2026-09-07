const AWARD_NAMES = [
  'Galactic Ruler',
  'Galactic Schemer',
  'Galactic Ambassador',
  'A New Hope',
  'Bounty Hunter',
];

// Standard competition ranking (1224 ranking)
export function assignStandardRanks(items) {
  if (!items || items.length === 0) return [];
  const sorted = [...items].sort((a, b) => (b.score || 0) - (a.score || 0));
  let rank = 1;
  let prevScore = null;
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].score !== prevScore) {
      rank = i + 1;
      prevScore = sorted[i].score;
    }
    sorted[i].displayRank = rank;
  }
  return sorted;
}

// Take top 3 with tie-aware boundary: if 4+ players share the 3rd-place score,
// keep all tied at that level (up to a reasonable cap).
function tieAwareTop3(items) {
  if (!items || items.length === 0) return [];
  const sorted = [...items].sort((a, b) => (b.score || 0) - (a.score || 0));
  if (sorted.length <= 3) return sorted;
  const thirdScore = sorted[2].score;
  return sorted.filter(e => e.score >= thirdScore);
}

// Compute Schemer award: most distinct leaders played
export async function computeSchemer(db, seasonId) {
  const rows = await db.prepare(`
    SELECT player_id, COUNT(DISTINCT leader_id) as distinct_leaders
    FROM leader_votes
    WHERE season_id = ?
    GROUP BY player_id
    ORDER BY distinct_leaders DESC
  `).bind(seasonId).all();

  const all = (rows.results || []).map(r => ({
    playerId: r.player_id,
    score: r.distinct_leaders,
  }));
  return tieAwareTop3(all);
}

// Compute Ambassador award: most favorite-opponent votes
export async function computeAmbassador(db, seasonId) {
  const rows = await db.prepare(`
    SELECT opponent_id as player_id, COUNT(*) as votes
    FROM opponent_votes
    WHERE season_id = ?
    GROUP BY opponent_id
    ORDER BY votes DESC
  `).bind(seasonId).all();

  const all = (rows.results || []).map(r => ({
    playerId: r.player_id,
    score: r.votes,
  }));
  return tieAwareTop3(all);
}

// Write a podium block for an award (supports tie-aware results > 3 entries)
export async function writePodiumBlock(db, seasonId, awardName, entries) {
  const topN = entries.slice(0, 5);

  if (topN.length === 0) {
    const existing = await db.prepare(
      "SELECT 1 FROM awards WHERE season_id = ? AND award_name = ? AND player_id != ''"
    ).bind(seasonId, awardName).first();
    if (existing) return;
  }

  await db.prepare(
    'DELETE FROM awards WHERE season_id = ? AND award_name = ?'
  ).bind(seasonId, awardName).run();

  for (let i = 0; i < 5; i++) {
    const entry = topN[i];
    await db.prepare(
      'INSERT INTO awards (season_id, award_name, player_id, score) VALUES (?, ?, ?, ?)'
    ).bind(
      seasonId,
      awardName,
      entry ? entry.playerId : '',
      entry ? entry.score : null
    ).run();
  }
}

export { AWARD_NAMES };
