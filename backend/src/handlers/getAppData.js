import { getSettings, getPlayerById, getAllActiveLeaders, getAllSeasons, parseSeasonId, parseWeek, isVotingOpen, isSeasonPaused, getCurrentVote } from '../db/queries.js';
import { getWeeklyParticipation, getAttendedStatus } from '../lib/participation.js';
import { filterFacedOpponents } from '../lib/voteValidation.js';

// Caller link state from the router-resolved session: unlinked / linked /
// invalid-token, plus this week's already-voted flag and vote content.
async function resolveLinkStatus(DB, session, token, activeSeasonId, currentWeek) {
  let status = 'unlinked';
  let linkedPlayer = null;
  let alreadySubmitted = false;
  let currentVote = null;

  if (session) {
    const player = await getPlayerById(DB, session.player_id);
    if (player) {
      status = 'linked';
      linkedPlayer = { id: player.id, name: player.name, email: player.email };
      if (activeSeasonId && currentWeek) {
        currentVote = await getCurrentVote(DB, activeSeasonId, currentWeek, player.id);
        alreadySubmitted = Boolean(currentVote);
      }
    } else {
      status = 'invalid-token';
    }
  } else if (token) {
    status = 'invalid-token';
  }

  return { status, linkedPlayer, alreadySubmitted, currentVote };
}

export async function handleGetAppData(body, env, session) {
  const { DB } = env;
  const token = body.token;

  const settings = await getSettings(DB);
  const rawSeasonId = settings.ACTIVE_SEASON_ID || '';
  const activeSeasonId = rawSeasonId ? parseSeasonId(rawSeasonId) : null;
  const currentWeek = parseWeek(settings.CURRENT_WEEK);
  const votingOpen = isVotingOpen(settings.VOTING_OPEN) && !isSeasonPaused(settings.SEASON_PAUSED);

  const seasons = await getAllSeasons(DB);
  const allPlayersResult = await DB.prepare('SELECT * FROM players').all();
  const allPlayers = allPlayersResult.results || [];
  const leaders = await getAllActiveLeaders(DB);

  const { players, facedOnly } = await filterFacedOpponents(
    DB, allPlayers, votingOpen, activeSeasonId, currentWeek, session && session.player_id
  );

  const { status, linkedPlayer, alreadySubmitted, currentVote } = await resolveLinkStatus(
    DB, session, token, activeSeasonId, currentWeek
  );

  // Weekly participation count
  let weeklyParticipation = null;
  if (activeSeasonId && currentWeek) {
    weeklyParticipation = await getWeeklyParticipation(DB, activeSeasonId, currentWeek);
  }

  // Did the current player attend this week? (null = week data not known)
  let attended = null;
  if (session && activeSeasonId && currentWeek) {
    attended = await getAttendedStatus(DB, activeSeasonId, currentWeek, session.player_id);
  }

  // Unlinked players for the link form picker
  let unlinkedPlayers = [];
  if (status === 'unlinked') {
    const unlinkedResult = await DB.prepare(
      "SELECT id, name FROM players WHERE (email IS NULL OR email = '') ORDER BY name"
    ).all();
    unlinkedPlayers = unlinkedResult.results || [];
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
    roster: allPlayers.map(p => ({ id: p.id, name: p.name })),
    facedOnly,
    unlinkedPlayers,
    leaders: (leaders.results || []).map(l => ({ id: l.id, name: l.name, set: l.set })),
    activeSeasonId,
    seasonName: seasons.results?.find(s => s.id === activeSeasonId)?.name,
    week: currentWeek,
    seasonId: activeSeasonId,
    alreadySubmitted,
    alreadyVoted: alreadySubmitted,
    currentVote,
    weeklyParticipation,
    attended,
  };
}
