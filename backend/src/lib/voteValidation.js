import { badRequest } from './errors.js';

// Accept the historical field-name variants for leader/opponent.
export function normalizeVoteData(voteData) {
  const d = voteData || {};
  return {
    leaderId: d.leader1Id || d.leaderId || d.leader || null,
    opponentId: d.opponentId || d.favoriteOpponentId || d.opponent || null,
  };
}

// Returns a Set of opponent ids the player faced in that round, or null when
// no match data exists (bye week or sync gap — callers treat null as "no restriction").
export async function getFacedOpponents(db, seasonId, week, playerId) {
  const rows = await db.prepare(
    'SELECT player1_id, player2_id FROM match_results WHERE season_id = ? AND round = ? AND is_bye = 0'
  ).bind(seasonId, week).all();

  const faced = new Set();
  let hasPlayerRows = false;
  for (const m of (rows.results || [])) {
    if (m.player1_id === playerId && m.player2_id) {
      faced.add(String(m.player2_id));
      hasPlayerRows = true;
    } else if (m.player2_id === playerId && m.player1_id) {
      faced.add(String(m.player1_id));
      hasPlayerRows = true;
    }
  }
  return hasPlayerRows ? faced : null;
}

export async function validateVote(db, { seasonId, week, playerId, leaderId, opponentId }) {
  if (!leaderId) throw badRequest('Please select your Leader.');
  if (!opponentId) throw badRequest('Please select your favorite opponent.');
  if (String(opponentId) === String(playerId)) {
    throw badRequest("You can't select yourself as your favorite opponent.");
  }

  const leader = await db.prepare('SELECT 1 FROM leaders WHERE id = ? AND active = 1').bind(leaderId).first();
  if (!leader) throw badRequest('Selected Leader is no longer available.');

  const opponent = await db.prepare('SELECT 1 FROM players WHERE id = ? AND active = 1').bind(opponentId).first();
  if (!opponent) throw badRequest('Selected opponent was not found.');

  const attended = await db.prepare(
    'SELECT 1 FROM attendance WHERE season_id = ? AND week = ? AND player_id = ?'
  ).bind(seasonId, week, playerId).first();
  if (!attended) {
    const weekHasAttendance = await db.prepare(
      'SELECT 1 FROM attendance WHERE season_id = ? AND week = ?'
    ).bind(seasonId, week).first();
    if (weekHasAttendance) throw badRequest('Only players who attended that week can vote.');
  }

  const faced = await getFacedOpponents(db, seasonId, week, playerId);
  if (faced && !faced.has(String(opponentId))) {
    throw badRequest('You can only vote for an opponent you faced that week.');
  }
}
