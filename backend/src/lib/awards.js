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

  for (let i = 0; i < topN.length; i++) {
    const entry = topN[i];
    await db.prepare(
      'INSERT INTO awards (season_id, award_name, player_id, score) VALUES (?, ?, ?, ?)'
    ).bind(
      seasonId,
      awardName,
      entry.playerId,
      entry.score
    ).run();
  }
}

export async function computeChampion(db, seasonId) {
  const lastCutTournament = await db.prepare(
    'SELECT melee_id, round FROM melee_tournaments WHERE season_id = ? AND phase = ? ORDER BY date DESC, melee_id DESC LIMIT 1'
  ).bind(seasonId, 'cut').first();

  if (!lastCutTournament) return [];

  const standings = await db.prepare(
    'SELECT player_id, rank FROM season_standings WHERE season_id = ? AND round = ?'
  ).bind(seasonId, lastCutTournament.round).all();

  const winners = (standings.results || [])
    .filter(s => s.rank === 1)
    .map(s => ({ playerId: s.player_id, score: s.rank }));

  return tieAwareTop3(winners);
}

export async function computeBountyHunter(db, seasonId) {
  const allSeasons = await db.prepare('SELECT id FROM seasons ORDER BY id DESC').all();
  const seasonIds = (allSeasons.results || []).map(s => s.id);
  const prevSeasonId = seasonIds.find(id => id < seasonId);

  if (!prevSeasonId) return [];

  const maxRound = await db.prepare(
    'SELECT MAX(round) as max_round FROM season_standings WHERE season_id = ?'
  ).bind(prevSeasonId).first();

  if (!maxRound?.max_round) return [];

  const prevStandings = await db.prepare(
    'SELECT player_id FROM season_standings WHERE season_id = ? AND round = ? AND rank <= 4'
  ).bind(prevSeasonId, maxRound.max_round).all();

  const top4Ids = (prevStandings.results || []).map(s => s.player_id);
  if (top4Ids.length === 0) return [];

  const allMatches = await db.prepare(
    'SELECT player1_id, player2_id, winner_id, is_bye FROM match_results WHERE season_id = ?'
  ).bind(seasonId).all();

  const wins = new Map();
  for (const m of (allMatches.results || [])) {
    if (m.is_bye || !m.winner_id) continue;
    if (m.winner_id === m.player1_id && top4Ids.includes(m.player1_id)) {
      wins.set(m.player1_id, (wins.get(m.player1_id) || 0) + 1);
    }
    if (m.winner_id === m.player2_id && top4Ids.includes(m.player2_id)) {
      wins.set(m.player2_id, (wins.get(m.player2_id) || 0) + 1);
    }
  }

  const allWins = [];
  for (const [pid, score] of wins) {
    allWins.push({ playerId: pid, score });
  }

  return tieAwareTop3(allWins);
}

export { AWARD_NAMES };
