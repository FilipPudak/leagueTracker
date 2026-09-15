import { getPlayerById, getPlayerByEmail, getAllSeasons, getSettings, isVotingOpen, isSeasonPaused, parseWeek, parseSeasonId } from '../db/queries.js';
import { createSession, findSessionByPlayerAndDevice } from '../lib/auth.js';
import { getWeeklyParticipation } from '../lib/participation.js';
import { getFacedOpponents } from '../lib/voteValidation.js';

export async function handleLinkAccount(body, env) {
  const { DB } = env;
  const { playerId: rawPlayerId, email, deviceId } = body;

  if (!deviceId) {
    const err = new Error('Missing device ID. Please try again.');
    err.status = 400;
    throw err;
  }

  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    const err = new Error('Please enter a valid email address.');
    err.status = 400;
    throw err;
  }

  // Multi-device: when no name is picked, an already-claimed account can be
  // re-linked on a new device by presenting the email it was claimed with.
  let playerId = rawPlayerId;
  if (!playerId) {
    const claimed = await getPlayerByEmail(DB, email);
    if (!claimed) {
      const err = new Error('No linked account found for that email. Choose your name from the list instead.');
      err.status = 404;
      throw err;
    }
    playerId = claimed.id;
  }

  // Verify player exists
  const player = await getPlayerById(DB, playerId);
  if (!player) {
    const err = new Error('Player not found.');
    err.status = 404;
    throw err;
  }

  // Check if email is already linked to a different player
  const existingByEmail = await getPlayerByEmail(DB, email);
  if (existingByEmail && existingByEmail.id !== playerId) {
    const err = new Error('This email is already linked to another player.');
    err.status = 409;
    throw err;
  }

  if (player.email && player.email.toLowerCase() !== email.toLowerCase()) {
    const err = new Error('This account already has an email. Please unlink first or contact an admin.');
    err.status = 403;
    throw err;
  }
  if (!player.email) {
    await DB.prepare('UPDATE players SET email = LOWER(?) WHERE id = ?')
      .bind(email.trim().toLowerCase(), playerId).run();
  }

  const session = await findSessionByPlayerAndDevice(DB, playerId, deviceId);
  let token;
  const now = new Date().toISOString();
  if (session) {
    token = session.token;
    await DB.prepare('UPDATE sessions SET last_active = ?, email = ? WHERE token = ?')
      .bind(now, email.trim().toLowerCase(), token).run();
  } else {
    token = await createSession(DB, playerId, deviceId, email);
  }

  // Get current state
  const allSettings = await getSettings(DB);
  const votingOpen = isVotingOpen(allSettings.VOTING_OPEN) && !isSeasonPaused(allSettings.SEASON_PAUSED);
  const activeSeasonId = parseSeasonId(allSettings.ACTIVE_SEASON_ID);
  const currentWeek = allSettings.CURRENT_WEEK;
  const weekNum = parseWeek(currentWeek);

  // Check if already voted (and carry the choice so Change Vote can prefill).
  let alreadyVoted = false;
  let currentVote = null;
  if (activeSeasonId && weekNum) {
    const vote = await DB.prepare(
      'SELECT leader_id, opponent_id FROM votes WHERE season_id = ? AND week = ? AND player_id = ?'
    ).bind(activeSeasonId, weekNum, playerId).first();
    if (vote) {
      alreadyVoted = true;
      currentVote = { leaderId: vote.leader_id, opponentId: vote.opponent_id };
    }
  }

  // Get leaders and players for the response. The opponent picker is narrowed to
  // the players actually faced this week (mirrors getAppData + submitVote validation);
  // full roster ships separately for labels and for the fallback case.
  const leaders = await DB.prepare('SELECT * FROM leaders WHERE active = 1 ORDER BY name').all();
  const rosterResult = await DB.prepare('SELECT id, name FROM players WHERE active = 1 ORDER BY name').all();
  const roster = rosterResult.results || [];
  let players = roster;
  let facedOnly = false;
  if (votingOpen && activeSeasonId && weekNum) {
    const faced = await getFacedOpponents(DB, activeSeasonId, weekNum, playerId);
    if (faced && faced.size > 0) {
      const filtered = roster.filter(p => faced.has(String(p.id)));
      if (filtered.length > 0) {
        players = filtered;
        facedOnly = true;
      }
    }
  }
  const seasons = await getAllSeasons(DB);

  // Weekly participation
  let weeklyParticipation = null;
  if (activeSeasonId && weekNum) {
    weeklyParticipation = await getWeeklyParticipation(DB, activeSeasonId, weekNum);
  }

  return {
    token,
    linkedPlayer: { id: player.id, name: player.name, email: email.trim().toLowerCase() },
    votingOpen,
    alreadyVoted,
    currentVote,
    leaders: (leaders.results || []).map(l => ({ id: l.id, name: l.name, set: l.set })),
    players: players.map(p => ({ id: p.id, name: p.name })),
    roster: roster.map(p => ({ id: p.id, name: p.name })),
    facedOnly,
    seasons: seasons.results || [],
    seasonName: seasons.results?.find(s => s.id === activeSeasonId)?.name,
    week: weekNum,
    seasonId: activeSeasonId,
    weeklyParticipation,
  };
}
