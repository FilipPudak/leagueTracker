import { getSettings, isVotingOpen, isSeasonPaused, parseSeasonId, parseWeek, hasPlayerVotedThisWeek } from '../db/queries.js';
import { getRaffleTickets, getWeeklyParticipation } from '../lib/participation.js';
import { normalizeVoteData, validateVote } from '../lib/voteValidation.js';
import { forbidden } from '../lib/errors.js';

export async function handleSubmitVote(body, env, session) {
  const { DB } = env;
  const { voteData: rawVoteData } = body;

  if (!session) {
    const err = new Error('Session expired. Please re-link to continue.');
    err.status = 401;
    throw err;
  }

  const playerId = session.player_id;
  const allSettings = await getSettings(DB);

  if (!isVotingOpen(allSettings.VOTING_OPEN)) {
    throw forbidden('Voting is currently closed for this week.');
  }

  if (isSeasonPaused(allSettings.SEASON_PAUSED)) {
    throw forbidden('The league season is paused. Voting is not available.');
  }

  const seasonId = parseSeasonId(allSettings.ACTIVE_SEASON_ID);
  const week = parseWeek(allSettings.CURRENT_WEEK);

  if (!seasonId || !week) {
    const err = new Error('No active season.');
    err.status = 400;
    throw err;
  }

  const { leaderId, opponentId } = normalizeVoteData(rawVoteData);
  await validateVote(DB, { seasonId, week, playerId, leaderId, opponentId });

  // Check for duplicate vote
  const existing = await hasPlayerVotedThisWeek(DB, seasonId, week, playerId);

  if (existing) {
    const err = new Error('You have already submitted votes for this week.');
    err.status = 409;
    throw err;
  }

  const now = new Date().toISOString();

  // Insert vote atomically; catch constraint violation for duplicate guard
  try {
    await DB.prepare(
      'INSERT INTO votes (timestamp, season_id, week, player_id, leader_id, opponent_id) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(now, seasonId, week, playerId, leaderId, opponentId).run();
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
