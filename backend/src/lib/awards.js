// Award computation logic (ported from GAS)

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
  let skip = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].score !== prevScore) {
      rank = i + 1;
      prevScore = sorted[i].score;
    } else {
      skip++;
    }
    sorted[i].displayRank = rank;
  }
  return sorted;
}

// Compute Schemer award: most distinct leaders played
export async function computeSchemer(db, seasonId) {
  const rows = await db.prepare(`
    SELECT player_id, COUNT(DISTINCT leader_id) as distinct_leaders
    FROM leader_votes
    WHERE season_id = ?
    GROUP BY player_id
    ORDER BY distinct_leaders DESC
    LIMIT 3
  `).bind(seasonId).all();

  return (rows.results || []).map(r => ({
    playerId: r.player_id,
    score: r.distinct_leaders,
  }));
}

// Compute Ambassador award: most favorite-opponent votes
export async function computeAmbassador(db, seasonId) {
  const rows = await db.prepare(`
    SELECT opponent_id as player_id, COUNT(*) as votes
    FROM opponent_votes
    WHERE season_id = ?
    GROUP BY opponent_id
    ORDER BY votes DESC
    LIMIT 3
  `).bind(seasonId).all();

  return (rows.results || []).map(r => ({
    playerId: r.player_id,
    score: r.votes,
  }));
}

// Write a podium block (3 rows) for an award
export async function writePodiumBlock(db, seasonId, awardName, entries) {
  // entries is array of { playerId, score } — up to 3
  const top3 = entries.slice(0, 3);

  // Delete existing entries for this award/season (idempotent)
  await db.prepare(
    'DELETE FROM awards WHERE season_id = ? AND award_name = ?'
  ).bind(seasonId, awardName).run();

  // Insert up to 3 rows
  for (let i = 0; i < 3; i++) {
    const entry = top3[i];
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
