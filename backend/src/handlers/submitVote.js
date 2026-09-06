import { getSetting, isVotingOpen } from '../db/queries.js';
import { getRaffleTickets, getWeeklyParticipation } from '../lib/participation.js';

export async function handleSubmitVote(body, env, session) {
  const { DB } = env;
  const { voteData: rawVoteData } = body;

  if (!session) {
    const err = new Error('Session expired. Please re-link to continue.');
    err.status = 401;
    throw err;
  }

  const playerId = session.player_id;
  const activeSeasonId = await getSetting(DB, 'ACTIVE_SEASON_ID');
  const currentWeek = await getSetting(DB, 'CURRENT_WEEK');
  const votingOpenVal = await getSetting(DB, 'VOTING_OPEN');

  if (!isVotingOpen(votingOpenVal)) {
    const err = new Error('Voting is currently closed for this week.');
    err.status = 403;
    throw err;
  }

  const seasonId = activeSeasonId ? parseInt(String(activeSeasonId).replace(/\D/g, ''), 10) : null;
  const week = currentWeek ? parseInt(String(currentWeek).replace(/\D/g, ''), 10) : null;

  if (!seasonId || !week) {
    const err = new Error('No active season.');
    err.status = 400;
    throw err;
  }

  // Normalize vote data: accept multiple field name variants
  const voteData = rawVoteData || {};
  const leader1Id = voteData.leader1Id || voteData.leaderId || voteData.leader;
  const opponentId = voteData.opponentId || voteData.favoriteOpponentId || voteData.opponent;

  if (!leader1Id) {
    const err = new Error('Please select your Leader.');
    err.status = 400;
    throw err;
  }

  // Prevent self-voting (only if opponent is provided)
  if (opponentId && String(opponentId) === String(playerId)) {
    const err = new Error("You can't select yourself as your favorite opponent.");
    err.status = 400;
    throw err;
  }

  // Check for duplicate vote
  const existing = await DB.prepare(
    'SELECT 1 FROM leader_votes WHERE season_id = ? AND week = ? AND player_id = ?'
  ).bind(seasonId, week, playerId).first();

  if (existing) {
    const err = new Error('You have already submitted votes for this week.');
    err.status = 409;
    throw err;
  }

  const now = new Date().toISOString();

  // Insert votes atomically; catch constraint violation for duplicate guard
  try {
    const statements = [
      DB.prepare(
        'INSERT INTO leader_votes (timestamp, season_id, week, player_id, leader_id) VALUES (?, ?, ?, ?, ?)'
      ).bind(now, seasonId, week, playerId, leader1Id),
    ];

    if (opponentId) {
      statements.push(
        DB.prepare(
          'INSERT INTO opponent_votes (timestamp, season_id, week, opponent_id) VALUES (?, ?, ?, ?)'
        ).bind(now, seasonId, week, opponentId)
      );
    }

    await DB.batch(statements);
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
