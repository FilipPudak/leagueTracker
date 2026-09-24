import { getSettings, parseSeasonId, parseWeek, isVotingOpen, isSeasonPaused } from '../db/queries.js';
import { getWeeklyParticipation as getWeeklyParticipationCount } from '../lib/participation.js';
import { getFacedOpponents } from '../lib/voteValidation.js';

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
    const row = await DB.prepare(
      'SELECT 1 FROM attendance WHERE season_id = ? AND week = ? AND player_id = ?'
    ).bind(activeSeasonId, currentWeek, session.player_id).first();
    attended = Boolean(row);

    const allPlayersResult = await DB.prepare('SELECT * FROM players').all();
    const allPlayers = allPlayersResult.results || [];
    players = allPlayers.map(p => ({ id: p.id, name: p.name }));

    if (votingOpen) {
      const faced = await getFacedOpponents(DB, activeSeasonId, currentWeek, session.player_id);
      if (faced && faced.size > 0) {
        const filtered = allPlayers.filter(p => faced.has(String(p.id)));
        if (filtered.length > 0) {
          players = filtered.map(p => ({ id: p.id, name: p.name }));
          facedOnly = true;
        }
      }
    }
  }

  return { weeklyParticipation, attended, players, facedOnly, votingOpen, week: currentWeek };
}
