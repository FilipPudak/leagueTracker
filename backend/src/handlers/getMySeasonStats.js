import { getSetting, getAwardsForSeason, parseSeasonId } from '../db/queries.js';
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
  let sid = seasonId ? parseSeasonId(seasonId) : null;

  if (!sid) {
    const activeSeasonId = await getSetting(DB, 'ACTIVE_SEASON_ID');
    sid = parseSeasonId(activeSeasonId);
  }

  if (!sid) {
    const err = new Error('No active season.');
    err.status = 400;
    throw err;
  }

  // Get awards won (only if player has the highest score for that award)
  const awards = await getAwardsForSeason(DB, sid);
  const allAwards = awards.results || [];
  const awardsWon = allAwards
    .filter(a => {
      if (a.player_id !== playerId) return false;
      const maxScore = Math.max(...allAwards
        .filter(x => x.award_name === a.award_name)
        .map(x => x.score ?? 0));
      return (a.score ?? 0) === maxScore;
    })
    .map(a => a.award_name);

  // Get leaders played (per-leader play counts from votes)
  const leadersRaw = await DB.prepare(`
    SELECT l.id, l.name, l."set", COUNT(v.id) as play_count
    FROM votes v
    JOIN leaders l ON v.leader_id = l.id
    WHERE v.season_id = ? AND v.player_id = ?
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

  // Voting milestone: progress toward 4 votes this season
  const milestoneTarget = 4;
  const milestoneVotes = raffleTickets; // 1 ticket per vote
  const milestone = {
    votes: milestoneVotes,
    target: milestoneTarget,
    complete: milestoneVotes >= milestoneTarget,
  };

  return {
    awardsWon,
    leaders,
    compliance,
    streaks,
    raffleTickets,
    milestone,
  };
}
