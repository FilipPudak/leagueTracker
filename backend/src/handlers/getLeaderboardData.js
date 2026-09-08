import { getSettings, getAwardsForSeason, getMostPlayedLeaders, parseSeasonId, parseWeek, isVotingOpen } from '../db/queries.js';
import { computeSchemer, computeAmbassador, assignStandardRanks } from '../lib/awards.js';
import { getSeasonParticipation } from '../lib/participation.js';

const AMBASSADOR_CALLSIGNS = [
  'Gold Leader', 'Green Leader', 'Red Leader',
  'Blade Eleven', 'Rogue One', 'Phoenix Leader',
];

export async function handleGetLeaderboardData(body, env) {
  const { DB } = env;
  const { seasonId: requestedSeasonId } = body;

  const settings = await getSettings(DB);
  const activeSeasonId = parseSeasonId(settings.ACTIVE_SEASON_ID);
  const currentWeek = parseWeek(settings.CURRENT_WEEK);
  const votingOpen = isVotingOpen(settings.VOTING_OPEN);

  const seasonId = requestedSeasonId ? Number(requestedSeasonId) : activeSeasonId;

  if (!seasonId) {
    const err = new Error('No season specified.');
    err.status = 400;
    throw err;
  }

  const isActiveSeason = seasonId === activeSeasonId;
  const isLive = votingOpen && isActiveSeason;

  // Batch-resolve player IDs → names
  const nameMap = await buildPlayerNameMap(DB);

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

  // Galactic Ruler: stored or live from season_standings
  let ruler = awardsMap['Galactic Ruler'] || null;
  if ((!ruler || ruler.length === 0) && isActiveSeason) {
    const lengthRow = await DB.prepare(
      'SELECT COUNT(*) as count FROM melee_tournaments WHERE season_id = ?'
    ).bind(seasonId).first();
    const seasonLength = lengthRow?.count || 11;
    const round = votingOpen && currentWeek ? currentWeek : seasonLength;
    const standings = await DB.prepare(
      'SELECT player_id, rank, match_points FROM season_standings WHERE season_id = ? AND round = ?'
    ).bind(seasonId, round).all();
    const rows = (standings.results || []).sort((a, b) => (a.rank || 999) - (b.rank || 999));
    const top3 = rows.filter(s => s.rank <= 3).slice(0, 3);
    ruler = top3.length > 0 ? assignStandardRanks(top3.map(s => ({
      playerId: s.player_id,
      score: s.match_points || 0,
      name: '',
    }))) : null;
  } else if (ruler) {
    ruler = assignStandardRanks(ruler);
  }

  // A New Hope: stored or live from season_standings
  let newHope = awardsMap['A New Hope'] || null;
  if ((!newHope || newHope.length === 0) && isActiveSeason) {
    const lengthRow = await DB.prepare(
      'SELECT COUNT(*) as count FROM melee_tournaments WHERE season_id = ?'
    ).bind(seasonId).first();
    const seasonLength = lengthRow?.count || 11;
    const midRound = Math.floor(seasonLength / 2);
    const finalRound = votingOpen && currentWeek ? currentWeek : seasonLength;
    const midStandings = await DB.prepare(
      'SELECT player_id, rank FROM season_standings WHERE season_id = ? AND round = ?'
    ).bind(seasonId, midRound).all();
    const finStandings = await DB.prepare(
      'SELECT player_id, rank FROM season_standings WHERE season_id = ? AND round = ?'
    ).bind(seasonId, finalRound).all();

    const midRows = midStandings.results || [];
    const finRows = finStandings.results || [];
    const midRankMap = new Map(midRows.map(s => [s.player_id, s.rank]));

    const climbers = finRows
      .map(s => ({
        playerId: s.player_id,
        climb: (midRankMap.get(s.player_id) || 0) - s.rank,
      }))
      .filter(c => c.climb > 0)
      .sort((a, b) => b.climb - a.climb)
      .slice(0, 3);

    newHope = climbers.length > 0 ? assignStandardRanks(climbers.map(c => ({
      playerId: c.playerId,
      score: c.climb,
      name: '',
    }))) : null;
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

  // Format scores
  schemer = formatScore(schemer, (e) => `${e.score} Leaders`);
  ambassador = formatScore(ambassador, (e) => `${e.score} Votes`);
  ruler = formatScore(ruler, (e) => `${e.score} Pts`);
  newHope = formatScore(newHope, (e) => `+${e.score} Climb`);
  const bountyHunterFormatted = formatScore(bountyHunterNamed, (e) => e.score ? `${e.score} 💀` : null);

  // Season name
  const seasons = await DB.prepare('SELECT id, name FROM seasons').all();
  const seasonName = (seasons.results || []).find(s => s.id === seasonId)?.name || null;

  return {
    seasonId,
    seasonName,
    isActiveSeason,
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
