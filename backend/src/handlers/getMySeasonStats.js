import { getSetting, getAwardsForSeason } from '../db/queries.js';
import { getCompliance, getStreaks, getRaffleTickets } from '../lib/participation.js';

export async function handleGetMySeasonStats(body, env, session) {
  const { DB } = env;
  const { seasonId } = body;

  if (!session) {
    const err = new Error('Session expired. Please re-link to continue.');
    err.status = 401;
    throw err;
  }

  const playerId = session.player_id;
  let sid = seasonId ? Number(seasonId) : null;

  if (!sid) {
    const activeSeasonId = await getSetting(DB, 'ACTIVE_SEASON_ID');
    sid = activeSeasonId ? parseInt(String(activeSeasonId).replace(/\D/g, ''), 10) : null;
  }

  if (!sid) {
    const err = new Error('No active season.');
    err.status = 400;
    throw err;
  }

  // Get awards won
  const awards = await getAwardsForSeason(DB, sid);
  const awardsWon = (awards.results || [])
    .filter(a => a.player_id === playerId)
    .map(a => a.award_name);

  // Get leaders played (per-leader play counts from leader_votes)
  const leadersRaw = await DB.prepare(`
    SELECT l.id, l.name, l."set", COUNT(lv.id) as play_count
    FROM leader_votes lv
    JOIN leaders l ON lv.leader_id = l.id
    WHERE lv.season_id = ? AND lv.player_id = ?
    GROUP BY l.id, l.name, l."set"
    ORDER BY play_count DESC
  `).bind(sid, playerId).all();

  const leaders = (leadersRaw.results || []).map(r => ({
    id: r.id,
    name: r.name,
    set: r.set,
    plays: r.play_count,
  }));

  // Gamification: compliance, streaks, raffle tickets
  const compliance = await getCompliance(DB, sid, playerId);
  const streaks = await getStreaks(DB, sid, playerId);
  const raffleTickets = await getRaffleTickets(DB, sid, playerId);

  return {
    awardsWon,
    leaders,
    compliance,
    streaks,
    raffleTickets,
  };
}
