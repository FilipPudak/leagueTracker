import { getSetting, getAwardsForSeason, parseSeasonId } from '../db/queries.js';
import { getStreaks, getRaffleTickets } from '../lib/participation.js';
import { badRequest } from '../lib/errors.js';
import { computeBadges } from '../lib/badges.js';
import { computeDeckWinRates } from '../lib/careerStats.js';

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
  const hasSeasonParam = seasonId !== undefined && seasonId !== null && seasonId !== '';
  let sid = hasSeasonParam ? parseSeasonId(seasonId) : null;
  if (hasSeasonParam && sid == null) throw badRequest('Invalid seasonId.');

  if (!sid) {
    sid = activeSeasonId;
  }

  if (!sid) {
    const err = new Error('No active season.');
    err.status = 400;
    throw err;
  }

  const isCurrentSeason = sid === activeSeasonId;

  // Awards are declared at season close: mid-season podium rows exist (sync
  // refreshes them weekly) but must never be listed as won in the active season.
  let awardsWon = [];
  if (!isCurrentSeason) {
    const awards = await getAwardsForSeason(DB, sid);
    const allAwards = awards.results || [];
    awardsWon = allAwards
      .filter(a => {
        if (a.player_id !== playerId) return false;
        const maxScore = Math.max(...allAwards
          .filter(x => x.award_name === a.award_name)
          .map(x => x.score ?? 0));
        return (a.score ?? 0) === maxScore;
      })
      .map(a => a.award_name);
  }

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

  const [raffleTickets, badges, deckWinRates] = await Promise.all([
    getRaffleTickets(DB, sid, playerId),
    computeBadges(DB, playerId),
    computeDeckWinRates(DB, playerId, sid),
  ]);
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
    leaders: leaders.map(l => {
      const deck = deckWinRates.find(d => d.leaderId === l.id);
      return {
        ...l,
        wins: deck ? deck.wins : 0,
        losses: deck ? deck.losses : 0,
        draws: deck ? deck.draws : 0,
        winPct: deck ? deck.winPct : null,
      };
    }),
    streaks,
    raffleTickets,
    milestone,
    badges,
    isCurrentSeason,
    hasVoteData,
  };
}
