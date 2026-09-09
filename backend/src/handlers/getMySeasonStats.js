import { getSetting, getAwardsForSeason, parseSeasonId } from '../db/queries.js';
import { getStreaks, getRaffleTickets } from '../lib/participation.js';

export async function handleGetMySeasonStats(body, env, session) {
  const { DB } = env;
  const { seasonId } = body;

  if (!session) {
    const err = new Error('Session expired. Please re-link to continue.');
    err.status = 401;
    throw err;
  }

  const playerId = session.player_id;
  const activeSeasonId = parseSeasonId(await getSetting(DB, 'ACTIVE_SEASON_ID'));
  let sid = seasonId ? parseSeasonId(seasonId) : null;

  if (!sid) {
    sid = activeSeasonId;
  }

  if (!sid) {
    const err = new Error('No active season.');
    err.status = 400;
    throw err;
  }

  const isCurrentSeason = sid === activeSeasonId;

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

  const raffleTickets = await getRaffleTickets(DB, sid, playerId);
  const hasVoteData = raffleTickets > 0;

  let streaks = await getStreaks(DB, sid, playerId);
  let milestone = null;
  if (isCurrentSeason) {
    const milestoneTarget = 4;
    milestone = {
      votes: raffleTickets,
      target: milestoneTarget,
      complete: raffleTickets >= milestoneTarget,
    };
  } else {
    streaks = { bestStreak: streaks.bestStreak };
  }

  return {
    awardsWon,
    leaders,
    streaks,
    raffleTickets,
    milestone,
    isCurrentSeason,
    hasVoteData,
  };
}
