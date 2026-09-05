import { getSettings, getAwardsForSeason, getMostPlayedLeaders } from '../db/queries.js';
import { computeSchemer, computeAmbassador, assignStandardRanks } from '../lib/awards.js';
import { getSeasonParticipation } from '../lib/participation.js';
import { fetchSeasonStandings } from '../lib/scraping.js';

const AMBASSADOR_CALLSIGNS = [
  'Gold Leader', 'Green Leader', 'Red Leader',
  'Blade Eleven', 'Rogue One', 'Phoenix Leader',
];

export async function handleGetLeaderboardData(body, env) {
  const { DB } = env;
  const { seasonId: requestedSeasonId } = body;

  const settings = await getSettings(DB);
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
  const isLive = votingOpen && isActiveSeason;

  // Batch-resolve player IDs → names and melee names → IDs
  const nameMap = await buildPlayerNameMap(DB);
  const meleeIdMap = await buildMeleeIdMap(DB);

  // Get stored awards
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
        playerId: meleeIdMap.get(s.username?.toLowerCase()) || null,
        score: s.points || 0,
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

  // Bounty Hunter: stored only, hidden while voting is live
  const bountyHunter = isLive ? null : (awardsMap['Bounty Hunter'] || null);

  // Season participation aggregate
  const participation = await getSeasonParticipation(DB, seasonId);

  // Resolve player names on all award lists
  schemer = resolveNames(schemer, nameMap);
  ambassador = resolveNames(ambassador, nameMap);
  ruler = resolveNames(ruler, nameMap);
  newHope = resolveNames(newHope, nameMap);
  const bountyHunterNamed = resolveNames(bountyHunter, nameMap);

  // Mask Ambassador names with callsigns while voting is live (privacy)
  if (isLive && ambassador) {
    ambassador.forEach((entry, i) => {
      entry.name = AMBASSADOR_CALLSIGNS[i] || `Vanguard-${i + 1}`;
    });
  }

  // Format scores to match GAS display
  schemer = formatScore(schemer, (e) => `${e.score} Leaders`);
  ambassador = formatScore(ambassador, (e) => `${e.score} Votes`);
  ruler = formatScore(ruler, (e) => `${e.score} Pts`);
  newHope = formatScore(newHope, (e) => `+${e.score} Climb`);
  const bountyHunterFormatted = formatScore(bountyHunterNamed, (e) => e.score ? `${e.score} 💀` : null);

  return {
    leaderLeaderboard: mostPlayedLeaders,
    schemer,
    ambassador,
    ruler,
    newHope,
    bountyHunter: bountyHunterFormatted,
    participation,
  };
}

async function buildPlayerNameMap(DB) {
  const rows = await DB.prepare('SELECT id, name FROM players').all();
  const map = {};
  for (const r of (rows.results || [])) {
    map[r.id] = r.name;
  }
  return map;
}

async function buildMeleeIdMap(DB) {
  const rows = await DB.prepare('SELECT id, melee_name FROM players WHERE melee_name IS NOT NULL').all();
  const map = new Map();
  for (const r of (rows.results || [])) {
    map.set(r.melee_name.toLowerCase(), r.id);
  }
  return map;
}

function resolveNames(items, nameMap) {
  if (!items || items.length === 0) return items;
  return items.map(item => ({
    ...item,
    name: item.name || nameMap[item.playerId] || item.playerId || 'Unknown',
  }));
}

function formatScore(items, formatter) {
  if (!items || items.length === 0) return items;
  return items.map(item => ({
    ...item,
    score: formatter(item),
  }));
}
