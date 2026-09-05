import { getSetting } from '../db/queries.js';
import { findSessionByToken, touchSessionTimestamp } from '../lib/auth.js';
import { getRaffleTickets, getWeeklyParticipation } from '../lib/participation.js';

export async function handleSubmitVote(body, env) {
  const { DB } = env;
  const { token, voteData, deviceId } = body;

  if (!token) {
    const err = new Error('Session expired. Please re-link to continue.');
    err.status = 401;
    throw err;
  }

  const session = await findSessionByToken(DB, token);
  if (!session) {
    const err = new Error('Session expired. Please re-link to continue.');
    err.status = 401;
    throw err;
  }

  await touchSessionTimestamp(DB, token);

  const playerId = session.player_id;
  const activeSeasonId = await getSetting(DB, 'ACTIVE_SEASON_ID');
  const currentWeek = await getSetting(DB, 'CURRENT_WEEK');
  const votingOpen = await getSetting(DB, 'VOTING_OPEN');

  if (votingOpen !== 'TRUE') {
    const err = new Error('Voting is currently closed for this week.');
    err.status = 403;
    throw err;
  }

  if (!activeSeasonId || !currentWeek) {
    const err = new Error('No active season.');
    err.status = 400;
    throw err;
  }

  const seasonId = Number(activeSeasonId);
  const week = parseInt(currentWeek.replace(/\D/g, ''), 10);

  // Check for duplicate vote
  const existing = await DB.prepare(
    'SELECT 1 FROM leader_votes WHERE season_id = ? AND week = ? AND player_id = ?'
  ).bind(seasonId, week, playerId).first();

  if (existing) {
    const err = new Error('You have already submitted votes for this week.');
    err.status = 409;
    throw err;
  }

  // Validate vote data
  if (!voteData || !voteData.leader1Id || !voteData.opponentId) {
    const err = new Error('Please select your Leader and Favorite Opponent.');
    err.status = 400;
    throw err;
  }

  // Prevent self-voting
  if (String(voteData.opponentId) === String(playerId)) {
    const err = new Error("You can't select yourself as your favorite opponent.");
    err.status = 400;
    throw err;
  }

  const now = new Date().toISOString();

  // Insert both votes atomically; catch constraint violation for duplicate guard
  try {
    await DB.prepare(
      'INSERT INTO leader_votes (timestamp, season_id, week, player_id, leader_id) VALUES (?, ?, ?, ?, ?)'
    ).bind(now, seasonId, week, playerId, voteData.leader1Id).run();

    await DB.prepare(
      'INSERT INTO opponent_votes (timestamp, season_id, week, opponent_id) VALUES (?, ?, ?, ?)'
    ).bind(now, seasonId, week, voteData.opponentId).run();
  } catch (e) {
    if (e.message && e.message.includes('UNIQUE constraint')) {
      const err = new Error('You have already submitted votes for this week.');
      err.status = 409;
      throw err;
    }
    throw e;
  }

  // Return raffle tickets and participation
  const raffleTickets = await getRaffleTickets(DB, seasonId, playerId);
  const weeklyParticipation = await getWeeklyParticipation(DB, seasonId, week);

  return { raffleTickets, weeklyParticipation };
}
