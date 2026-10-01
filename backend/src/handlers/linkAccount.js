import { getPlayerById, getPlayerByEmail, getAllSeasons, getSettings, isVotingOpen, isSeasonPaused, parseWeek, parseSeasonId, getCurrentVote } from '../db/queries.js';
import { createSession, findSessionByPlayerAndDevice } from '../lib/auth.js';
import { getWeeklyParticipation, getAttendedStatus } from '../lib/participation.js';
import { filterFacedOpponents } from '../lib/voteValidation.js';

// Full email-claim decision chain — every rejection keeps its exact status
// and message so the link form can surface them verbatim.
async function resolveLinkTarget(DB, rawPlayerId, email, deviceId) {
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

  const player = await getPlayerById(DB, playerId);
  if (!player) {
    const err = new Error('Player not found.');
    err.status = 404;
    throw err;
  }

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

  return { playerId, player };
}

// Honor-based claim permanence above: same device reuses its token; a new
// device for the same player gets its own session.
async function issueSessionToken(DB, playerId, deviceId, email) {
  const session = await findSessionByPlayerAndDevice(DB, playerId, deviceId);
  if (session) {
    const now = new Date().toISOString();
    await DB.prepare('UPDATE sessions SET last_active = ?, email = ? WHERE token = ?')
      .bind(now, email.trim().toLowerCase(), session.token).run();
    return session.token;
  }
  return createSession(DB, playerId, deviceId, email);
}

export async function handleLinkAccount(body, env) {
  const { DB } = env;
  const { playerId: rawPlayerId, email, deviceId } = body;

  const { playerId, player } = await resolveLinkTarget(DB, rawPlayerId, email, deviceId);
  const token = await issueSessionToken(DB, playerId, deviceId, email);

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
    currentVote = await getCurrentVote(DB, activeSeasonId, weekNum, playerId);
    alreadyVoted = Boolean(currentVote);
  }

  // Get leaders and players for the response. The opponent picker is narrowed to
  // the players actually faced this week (mirrors getAppData + submitVote validation);
  // full roster ships separately for labels and for the fallback case.
  const leaders = await DB.prepare('SELECT * FROM leaders WHERE active = 1 ORDER BY name').all();
  const rosterResult = await DB.prepare('SELECT id, name FROM players WHERE active = 1 ORDER BY name').all();
  const roster = rosterResult.results || [];
  const { players, facedOnly } = await filterFacedOpponents(
    DB, roster, votingOpen, activeSeasonId, weekNum, playerId
  );
  const seasons = await getAllSeasons(DB);

  // Weekly participation
  let weeklyParticipation = null;
  if (activeSeasonId && weekNum) {
    weeklyParticipation = await getWeeklyParticipation(DB, activeSeasonId, weekNum);
  }

  // Did the player attend this week? (null = week data not known)
  let attended = null;
  if (activeSeasonId && weekNum) {
    attended = await getAttendedStatus(DB, activeSeasonId, weekNum, playerId);
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
    attended,
  };
}
