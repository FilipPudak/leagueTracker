import { getPlayerById, getPlayerByEmail, getAllActivePlayers, getAllActiveLeaders, getAllSeasons, getSetting, updateSetting } from '../db/queries.js';
import { createSession, findSessionByPlayerAndDevice } from '../lib/auth.js';
import { getWeeklyParticipation } from '../lib/participation.js';

export async function handleLinkAccount(body, env) {
  const { DB } = env;
  const { playerId, email, deviceId } = body;

  if (!playerId) {
    const err = new Error('Please select your player name.');
    err.status = 400;
    throw err;
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    const err = new Error('Please enter a valid email address.');
    err.status = 400;
    throw err;
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

  // Update player email (if not already set)
  if (!player.email || player.email.toLowerCase() !== email.toLowerCase()) {
    await DB.prepare('UPDATE players SET email = LOWER(?) WHERE id = ?')
      .bind(email.trim().toLowerCase(), playerId).run();
  }

  // Create or reuse session token
  let session = await findSessionByPlayerAndDevice(DB, playerId, deviceId);
  let token;
  if (session) {
    token = session.token;
    // Touch last_active
    await DB.prepare("UPDATE sessions SET last_active = datetime('now'), email = ? WHERE token = ?")
      .bind(email.trim().toLowerCase(), token).run();
  } else {
    token = await createSession(DB, playerId, deviceId, email);
  }

  // Get current state
  const settings = await getSetting(DB, 'VOTING_OPEN');
  const votingOpen = settings === 'TRUE';
  const activeSeasonId = await getSetting(DB, 'ACTIVE_SEASON_ID');
  const currentWeek = await getSetting(DB, 'CURRENT_WEEK');
  const weekNum = currentWeek ? parseInt(currentWeek.replace(/\D/g, ''), 10) : 1;

  // Check if already voted
  let alreadyVoted = false;
  if (activeSeasonId && weekNum) {
    const row = await DB.prepare(
      'SELECT 1 FROM leader_votes WHERE season_id = ? AND week = ? AND player_id = ?'
    ).bind(Number(activeSeasonId), weekNum, playerId).first();
    alreadyVoted = !!row;
  }

  // Get leaders and players for the response
  const leaders = await DB.prepare('SELECT * FROM leaders WHERE active = 1 ORDER BY name').all();
  const players = await DB.prepare('SELECT id, name FROM players WHERE active = 1 ORDER BY name').all();
  const seasons = await getAllSeasons(DB);

  // Weekly participation
  let weeklyParticipation = null;
  if (activeSeasonId && weekNum) {
    weeklyParticipation = await getWeeklyParticipation(DB, Number(activeSeasonId), weekNum);
  }

  return {
    token,
    linkedPlayer: { id: player.id, name: player.email ? player.name : player.name, email: email.trim().toLowerCase() },
    votingOpen,
    alreadyVoted,
    leaders: (leaders.results || []).map(l => ({ id: l.id, name: l.name, set: l.set })),
    players: (players.results || []).map(p => ({ id: p.id, name: p.name })),
    seasons: seasons.results || [],
    seasonName: seasons.results?.find(s => s.id === Number(activeSeasonId))?.name,
    week: weekNum,
    seasonId: Number(activeSeasonId),
    weeklyParticipation,
  };
}
