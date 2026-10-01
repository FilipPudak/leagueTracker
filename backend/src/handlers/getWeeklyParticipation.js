import { getSettings, parseSeasonId, parseWeek, isVotingOpen, isSeasonPaused } from '../db/queries.js';
import { getWeeklyParticipation as getWeeklyParticipationCount, getAttendedStatus } from '../lib/participation.js';
import { filterFacedOpponents } from '../lib/voteValidation.js';

export async function handleGetWeeklyParticipation(body, env, session) {
  const { DB } = env;
  const settings = await getSettings(DB);
  const rawSeasonId = settings.ACTIVE_SEASON_ID || '';
  const activeSeasonId = rawSeasonId ? parseSeasonId(rawSeasonId) : null;
  const currentWeek = parseWeek(settings.CURRENT_WEEK);
  const votingOpen = isVotingOpen(settings.VOTING_OPEN) && !isSeasonPaused(settings.SEASON_PAUSED);

  if (!activeSeasonId || !currentWeek) {
    return { weeklyParticipation: null, attended: null, players: null, facedOnly: false, votingOpen, week: null };
  }

  const weeklyParticipation = await getWeeklyParticipationCount(DB, activeSeasonId, currentWeek);

  let attended = null;
  let players = null;
  let facedOnly = false;

  if (session) {
    attended = await getAttendedStatus(DB, activeSeasonId, currentWeek, session.player_id);

    const allPlayersResult = await DB.prepare('SELECT * FROM players').all();
    const allPlayers = allPlayersResult.results || [];
    const candidates = allPlayers.map(p => ({ id: p.id, name: p.name }));
    const filtered = await filterFacedOpponents(
      DB, candidates, votingOpen, activeSeasonId, currentWeek, session.player_id
    );
    players = filtered.players;
    facedOnly = filtered.facedOnly;
  }

  return { weeklyParticipation, attended, players, facedOnly, votingOpen, week: currentWeek };
}
