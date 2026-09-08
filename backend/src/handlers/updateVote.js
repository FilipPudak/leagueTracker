import { getSettings, isVotingOpen, parseSeasonId, parseWeek, hasPlayerVotedThisWeek } from '../db/queries.js';
import { getRaffleTickets, getWeeklyParticipation } from '../lib/participation.js';

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
  const votingOpenVal = allSettings.VOTING_OPEN;

  if (!isVotingOpen(votingOpenVal)) {
    const err = new Error('Voting is currently closed. Cannot update vote.');
    err.status = 403;
    throw err;
  }

  const seasonId = parseSeasonId(allSettings.ACTIVE_SEASON_ID);
  const week = parseWeek(allSettings.CURRENT_WEEK);

  if (!seasonId || !week) {
    const err = new Error('No active season.');
    err.status = 400;
    throw err;
  }

  const voteData = rawVoteData || {};
  const leader1Id = voteData.leader1Id || voteData.leaderId || voteData.leader;
  const opponentId = voteData.opponentId || voteData.favoriteOpponentId || voteData.opponent;

  if (!leader1Id) {
    const err = new Error('Please select your Leader.');
    err.status = 400;
    throw err;
  }

  if (!opponentId) {
    const err = new Error('Please select your favorite opponent.');
    err.status = 400;
    throw err;
  }

  if (String(opponentId) === String(playerId)) {
    const err = new Error("You can't select yourself as your favorite opponent.");
    err.status = 400;
    throw err;
  }

  const existing = await hasPlayerVotedThisWeek(DB, seasonId, week, playerId);

  if (!existing) {
    const err = new Error('No vote to update. Use submitVote instead.');
    err.status = 404;
    throw err;
  }

  const now = new Date().toISOString();

  await DB.prepare(
    'UPDATE votes SET leader_id = ?, opponent_id = ?, updated_at = ? WHERE season_id = ? AND week = ? AND player_id = ?'
  ).bind(leader1Id, opponentId, now, seasonId, week, playerId).run();

  const raffleTickets = await getRaffleTickets(DB, seasonId, playerId);
  const weeklyParticipation = await getWeeklyParticipation(DB, seasonId, week);

  return { raffleTickets, weeklyParticipation };
}
