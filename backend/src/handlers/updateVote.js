import { getSettings, isVotingOpen, isSeasonPaused, parseSeasonId, parseWeek, hasPlayerVotedThisWeek } from '../db/queries.js';
import { getRaffleTickets, getWeeklyParticipation } from '../lib/participation.js';
import { normalizeVoteData, validateVote } from '../lib/voteValidation.js';
import { forbidden } from '../lib/errors.js';

export async function handleUpdateVote(body, env, session) {
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
    throw forbidden('Voting is currently closed. Cannot update vote.');
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

  const existing = await hasPlayerVotedThisWeek(DB, seasonId, week, playerId);

  if (!existing) {
    const err = new Error('No vote to update. Use submitVote instead.');
    err.status = 404;
    throw err;
  }

  const { leaderId, opponentId } = normalizeVoteData(rawVoteData);
  await validateVote(DB, { seasonId, week, playerId, leaderId, opponentId });

  const now = new Date().toISOString();

  await DB.prepare(
    'UPDATE votes SET leader_id = ?, opponent_id = ?, updated_at = ? WHERE season_id = ? AND week = ? AND player_id = ?'
  ).bind(leaderId, opponentId, now, seasonId, week, playerId).run();

  const raffleTickets = await getRaffleTickets(DB, seasonId, playerId);
  const weeklyParticipation = await getWeeklyParticipation(DB, seasonId, week);

  return { raffleTickets, weeklyParticipation };
}
