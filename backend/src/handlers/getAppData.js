import { getSettings, getPlayerById, getAllActivePlayers, getAllActiveLeaders, getAllSeasons } from '../db/queries.js';
import { findSessionByToken, touchSessionTimestamp } from '../lib/auth.js';
import { getWeeklyParticipation } from '../lib/participation.js';

export async function handleGetAppData(body, env) {
  const { DB } = env;
  const { token } = body;

  const settings = await getSettings(DB);
  const rawSeasonId = settings.ACTIVE_SEASON_ID || '';
  const activeSeasonId = rawSeasonId ? parseInt(String(rawSeasonId).replace(/\D/g, ''), 10) : null;
  const currentWeek = settings.CURRENT_WEEK ? parseInt(settings.CURRENT_WEEK.replace(/\D/g, ''), 10) : 1;
  const votingOpen = settings.VOTING_OPEN === 'TRUE';

  const seasons = await getAllSeasons(DB);
  const players = await getAllActivePlayers(DB);
  const leaders = await getAllActiveLeaders(DB);

  let status = 'unlinked';
  let linkedPlayer = null;
  let alreadySubmitted = false;

  if (token) {
    const session = await findSessionByToken(DB, token);
    if (session) {
      await touchSessionTimestamp(DB, token);
      const player = await getPlayerById(DB, session.player_id);
      if (player) {
        status = 'linked';
        linkedPlayer = { id: player.id, name: player.name, email: player.email };

        // Check if already voted this week
        if (activeSeasonId && currentWeek) {
          const row = await DB.prepare(
            'SELECT 1 FROM leader_votes WHERE season_id = ? AND week = ? AND player_id = ?'
          ).bind(activeSeasonId, currentWeek, player.id).first();
          alreadySubmitted = !!row;
        }
      } else {
        status = 'invalid-token';
      }
    } else {
      status = 'invalid-token';
    }
  }

  // Weekly participation count
  let weeklyParticipation = null;
  if (activeSeasonId && currentWeek) {
    weeklyParticipation = await getWeeklyParticipation(DB, activeSeasonId, currentWeek);
  }

  return {
    status,
    linkedPlayer,
    votingOpen,
    settings,
    seasons: seasons.results || [],
    players: (players.results || []).map(p => ({ id: p.id, name: p.name })),
    leaders: (leaders.results || []).map(l => ({ id: l.id, name: l.name, set: l.set })),
    activeSeasonId,
    seasonName: seasons.results?.find(s => s.id === activeSeasonId)?.name,
    week: currentWeek,
    seasonId: activeSeasonId,
    alreadySubmitted,
    weeklyParticipation,
  };
}
