import { getSettings, getPlayerById, getAllActivePlayers, getAllActiveLeaders, getAllSeasons, parseSeasonId, parseWeek, isVotingOpen, hasPlayerVotedThisWeek } from '../db/queries.js';
import { getWeeklyParticipation } from '../lib/participation.js';

export async function handleGetAppData(body, env, session) {
  const { DB } = env;
  const token = body.token;

  const settings = await getSettings(DB);
  const rawSeasonId = settings.ACTIVE_SEASON_ID || '';
  const activeSeasonId = rawSeasonId ? parseSeasonId(rawSeasonId) : null;
  const currentWeek = parseWeek(settings.CURRENT_WEEK);
  const votingOpen = isVotingOpen(settings.VOTING_OPEN);

  const seasons = await getAllSeasons(DB);
  const allActivePlayersResult = await getAllActivePlayers(DB);
  const allActivePlayers = allActivePlayersResult.results || [];
  const leaders = await getAllActiveLeaders(DB);

  let players = allActivePlayers;

  if (votingOpen && session && activeSeasonId && currentWeek) {
    const matchRow = await DB.prepare(
      'SELECT 1 FROM match_results WHERE season_id = ? AND round = ? AND (player1_id = ? OR player2_id = ?) AND is_bye = 0 LIMIT 1'
    ).bind(activeSeasonId, currentWeek, session.player_id, session.player_id).first();

    if (matchRow) {
      const matches = await DB.prepare(
        'SELECT player1_id, player2_id FROM match_results WHERE season_id = ? AND round = ? AND (player1_id = ? OR player2_id = ?) AND is_bye = 0'
      ).bind(activeSeasonId, currentWeek, session.player_id, session.player_id).all();

      const opponentIds = new Set();
      for (const m of (matches.results || [])) {
        if (m.player1_id === session.player_id && m.player2_id) opponentIds.add(m.player2_id);
        if (m.player2_id === session.player_id && m.player1_id) opponentIds.add(m.player1_id);
      }

      const filtered = allActivePlayers.filter(p => opponentIds.has(p.id));
      if (filtered.length > 0) {
        players = filtered;
      }
    }
  }

  let status = 'unlinked';
  let linkedPlayer = null;
  let alreadySubmitted = false;

  if (session) {
    const player = await getPlayerById(DB, session.player_id);
    if (player) {
      status = 'linked';
      linkedPlayer = { id: player.id, name: player.name, email: player.email };

      // Check if already voted this week
      if (activeSeasonId && currentWeek) {
        alreadySubmitted = await hasPlayerVotedThisWeek(DB, activeSeasonId, currentWeek, player.id);
      }
    } else {
      status = 'invalid-token';
    }
  } else if (token) {
    status = 'invalid-token';
  }

  // Weekly participation count
  let weeklyParticipation = null;
  if (activeSeasonId && currentWeek) {
    weeklyParticipation = await getWeeklyParticipation(DB, activeSeasonId, currentWeek);
  }

  // Unlinked players for the link form picker
  let unlinkedPlayers = [];
  if (status === 'unlinked') {
    const allPlayers = await DB.prepare(
      "SELECT id, name FROM players WHERE active = 1 AND (email IS NULL OR email = '') ORDER BY name"
    ).all();
    unlinkedPlayers = allPlayers.results || [];
  }

  const safeSettings = {
    WEEKLY_DEADLINE_DAY: settings.WEEKLY_DEADLINE_DAY,
    WEEKLY_DEADLINE_TIME: settings.WEEKLY_DEADLINE_TIME,
    TIMEZONE: settings.TIMEZONE,
  };

  return {
    status,
    linkedPlayer,
    currentPlayer: linkedPlayer,
    votingOpen,
    settings: safeSettings,
    seasons: seasons.results || [],
    players: players.map(p => ({ id: p.id, name: p.name })),
    unlinkedPlayers,
    leaders: (leaders.results || []).map(l => ({ id: l.id, name: l.name, set: l.set })),
    activeSeasonId,
    seasonName: seasons.results?.find(s => s.id === activeSeasonId)?.name,
    week: currentWeek,
    seasonId: activeSeasonId,
    alreadySubmitted,
    alreadyVoted: alreadySubmitted,
    weeklyParticipation,
  };
}
