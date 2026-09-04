import { getSetting } from '../db/queries.js';
import { getAwardsForSeason, getMostPlayedLeaders } from '../db/queries.js';
import { computeSchemer, computeAmbassador, assignStandardRanks } from '../lib/awards.js';
import { getSeasonParticipation } from '../lib/participation.js';
import { fetchSeasonStandings } from '../lib/scraping.js';

export async function handleGetLeaderboardData(body, env) {
  const { DB } = env;
  const { seasonId: requestedSeasonId } = body;

  const settings = await getSettingsCached(DB);
  const activeSeasonId = settings.ACTIVE_SEASON_ID ? Number(settings.ACTIVE_SEASON_ID) : null;
  const currentWeek = settings.CURRENT_WEEK ? parseInt(settings.CURRENT_WEEK.replace(/\D/g, ''), 10) : 1;
  const votingOpen = settings.VOTING_OPEN === 'TRUE';
  const seasonLength = settings.SEASON_LENGTH ? Number(settings.SEASON_LENGTH) : 11;

  const seasonId = requestedSeasonId ? Number(requestedSeasonId) : activeSeasonId;

  if (!seasonId) {
    const err = new Error('No season specified.');
    err.status = 400;
    throw err;
  }

  const isActiveSeason = seasonId === activeSeasonId;

  // Get stored awards (if season is closed)
  const awards = await getAwardsForSeason(DB, seasonId);
  const awardsMap = {};
  for (const a of (awards.results || [])) {
    if (!awardsMap[a.award_name]) awardsMap[a.award_name] = [];
    if (a.player_id) awardsMap[a.award_name].push({ playerId: a.player_id, score: a.score });
  }

  // Most Played Leaders (always live)
  const mostPlayedRaw = await getMostPlayedLeaders(DB, seasonId);
  const mostPlayedLeaders = assignStandardRanks(
    (mostPlayedRaw.results || []).map(r => ({
      id: r.id, name: r.name, set: r.set, score: r.play_count,
    }))
  );

  // Schemer: stored award or live compute
  let schemer = awardsMap['Galactic Schemer'] || null;
  if (!schemer || schemer.length === 0) {
    const live = await computeSchemer(DB, seasonId);
    schemer = live.length > 0 ? assignStandardRanks(live) : null;
  } else {
    schemer = assignStandardRanks(schemer);
  }

  // Ambassador: stored award or live compute
  let ambassador = awardsMap['Galactic Ambassador'] || null;
  if (!ambassador || ambassador.length === 0) {
    const live = await computeAmbassador(DB, seasonId);
    ambassador = live.length > 0 ? assignStandardRanks(live) : null;
  } else {
    ambassador = assignStandardRanks(ambassador);
  }

  // Galactic Ruler: stored or live from SWU site
  let ruler = awardsMap['Galactic Ruler'] || null;
  if ((!ruler || ruler.length === 0) && isActiveSeason) {
    const round = votingOpen ? currentWeek : seasonLength;
    const standings = await fetchSeasonStandings(seasonId, round);
    if (standings) {
      const top3 = standings.filter(s => s.rank <= 3);
      ruler = assignStandardRanks(top3.map(s => ({
        playerId: findPlayerByMelee(DB, s.username),
        score: s.rank,
        name: s.name,
      })));
    }
  } else if (ruler) {
    ruler = assignStandardRanks(ruler);
  }

  // A New Hope: stored or live from SWU site
  let newHope = awardsMap['A New Hope'] || null;
  if ((!newHope || newHope.length === 0) && isActiveSeason) {
    const midRound = Math.floor(seasonLength / 2);
    const finalRound = votingOpen ? currentWeek : seasonLength;
    const midStandings = await fetchSeasonStandings(seasonId, midRound);
    const finStandings = await fetchSeasonStandings(seasonId, finalRound);

    if (midStandings && finStandings) {
      const midMap = new Map(midStandings.map(s => [s.username, s.rank]));
      const climbers = finStandings
        .map(s => ({
          username: s.username,
          name: s.name,
          climb: (midMap.get(s.username) || 0) - s.rank,
        }))
        .filter(c => c.climb > 0)
        .sort((a, b) => b.climb - a.climb)
        .slice(0, 3);

      newHope = assignStandardRanks(climbers.map(c => ({
        name: c.name,
        score: c.climb,
      })));
    }
  } else if (newHope) {
    newHope = assignStandardRanks(newHope);
  }

  // Bounty Hunter: stored only
  const bountyHunter = awardsMap['Bounty Hunter'] || null;

  // Season participation aggregate
  const participation = await getSeasonParticipation(DB, seasonId);

  return {
    leaderLeaderboard: mostPlayedLeaders,
    schemer,
    ambassador,
    ruler,
    newHope,
    bountyHunter,
    participation,
  };
}

// Helper: get settings cached
async function getSettingsCached(DB) {
  const rows = await DB.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const row of rows.results) {
    settings[row.key] = row.value;
  }
  return settings;
}

// Helper: find player ID by melee name (for SWU site matching)
async function findPlayerByMelee(DB, meleeName) {
  const row = await DB.prepare(
    'SELECT id FROM players WHERE LOWER(melee_name) = LOWER(?)'
  ).bind(meleeName).first();
  return row ? row.id : null;
}
