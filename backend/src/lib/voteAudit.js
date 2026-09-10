// Retroactive vote reconciliation: after a week's real data lands, re-judge
// existing votes against the same rules validateVote enforces at write time.
// Votes are never deleted (audit-only). Returns voter IDs + violation types;
// never includes the voter→opponent pair (anonymity display invariant).

export async function auditVotesForWeek(db, seasonId, week) {
  const votes = await db.prepare(
    'SELECT player_id, opponent_id FROM votes WHERE season_id = ? AND week = ?'
  ).bind(seasonId, week).all();
  const voteRows = votes.results || [];
  if (voteRows.length === 0) return { week, total: 0, nonAttendees: [], notFaced: [] };

  const attendance = await db.prepare(
    'SELECT player_id FROM attendance WHERE season_id = ? AND week = ?'
  ).bind(seasonId, week).all();
  const attended = new Set((attendance.results || []).map(a => a.player_id));

  const matches = await db.prepare(
    'SELECT player1_id, player2_id FROM match_results WHERE season_id = ? AND round = ? AND is_bye = 0'
  ).bind(seasonId, week).all();
  const facedBy = new Map();
  for (const m of matches.results || []) {
    if (!m.player1_id || !m.player2_id) continue;
    if (!facedBy.has(m.player1_id)) facedBy.set(m.player1_id, new Set());
    if (!facedBy.has(m.player2_id)) facedBy.set(m.player2_id, new Set());
    facedBy.get(m.player1_id).add(m.player2_id);
    facedBy.get(m.player2_id).add(m.player1_id);
  }

  const nonAttendees = [];
  const notFaced = [];
  for (const v of voteRows) {
    if (!attended.has(v.player_id)) {
      nonAttendees.push(v.player_id);
      continue;
    }
    const faced = facedBy.get(v.player_id);
    if (faced && faced.size > 0 && !faced.has(v.opponent_id)) {
      notFaced.push(v.player_id);
    }
  }

  return { week, total: voteRows.length, nonAttendees, notFaced };
}
