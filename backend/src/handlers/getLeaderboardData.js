import { getSettings, getAwardsForSeason, getMostPlayedLeaders, parseSeasonId, parseWeek, isVotingOpen } from '../db/queries.js';
import { computeSchemer, computeAmbassador, computeChampion, assignStandardRanks } from '../lib/awards.js';
import { getSeasonParticipation } from '../lib/participation.js';
import { computeSeasonTable } from '../lib/seasonTable.js';

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
  const seasonEnded = settings.CURRENT_WEEK === 'Season Ended';

  const seasonId = requestedSeasonId ? parseSeasonId(requestedSeasonId) : activeSeasonId;

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
    const season = await DB.prepare('SELECT length, top_results FROM seasons WHERE id = ?').bind(seasonId).first();
    const seasonLength = season?.length || 11;
    const round = seasonEnded ? seasonLength : (votingOpen && currentWeek ? currentWeek : seasonLength);
    const standings = await DB.prepare(
      'SELECT player_id, rank, match_points FROM season_standings WHERE season_id = ? AND round = ?'
    ).bind(seasonId, round).all();
    const rows = (standings.results || []).sort((a, b) => (a.rank || 999) - (b.rank || 999));
    const top3 = rows.filter(s => s.rank != null && s.rank <= 3).slice(0, 3);
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
    const season = await DB.prepare('SELECT length, top_results FROM seasons WHERE id = ?').bind(seasonId).first();
    const seasonLength = season?.length || 11;
    const topResults = season?.top_results || 7;
    const midRound = Math.floor(seasonLength / 2);

    // Mid-season: raw accumulated standings
    const regularRoundsForMid = await DB.prepare(
      'SELECT DISTINCT round FROM melee_tournaments WHERE season_id = ? AND phase = ? AND round <= ?'
    ).bind(seasonId, 'regular', midRound).all();
    const regularMidRoundSet = new Set((regularRoundsForMid.results || []).map(r => r.round));

    const midStandings = await DB.prepare(
      'SELECT player_id, round, match_points FROM season_standings WHERE season_id = ? AND round <= ?'
    ).bind(seasonId, midRound).all();

    const midPointsMap = new Map();
    for (const row of (midStandings.results || [])) {
      if (!regularMidRoundSet.has(row.round)) continue;
      midPointsMap.set(row.player_id, (midPointsMap.get(row.player_id) || 0) + (row.match_points || 0));
    }

    const midEntries = [...midPointsMap.entries()].sort((a, b) => b[1] - a[1]);
    const midRankMap = new Map();
    let midRank = 1;
    for (const [pid] of midEntries) {
      midRankMap.set(pid, midRank++);
    }

    // Final: derived season table (best-X)
    const finalRound = seasonEnded ? seasonLength : (votingOpen && currentWeek ? currentWeek : seasonLength);
    const allStandings = await DB.prepare(
      'SELECT round, player_id, wins, losses, draws, match_points, rank FROM season_standings WHERE season_id = ? AND round <= ?'
    ).bind(seasonId, finalRound).all();

    const nights = (allStandings.results || []).map(s => ({
      playerId: s.player_id,
      round: s.round,
      wins: s.wins || 0,
      draws: s.draws || 0,
      losses: s.losses || 0,
      rank: s.rank,
    }));

    const seasonTable = computeSeasonTable(nights, topResults);
    const finalRankMap = new Map(seasonTable.map(r => [r.playerId, r.rank]));

    const climbers = [...midRankMap.keys()]
      .filter(pid => finalRankMap.has(pid))
      .map(pid => ({
        playerId: pid,
        climb: (midRankMap.get(pid) || 0) - (finalRankMap.get(pid) || 0),
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
  let bountyHunter = isLive ? null : (awardsMap['Bounty Hunter'] || null);
  if (bountyHunter) bountyHunter = assignStandardRanks(bountyHunter);

  // Galactic Champion: stored or live from cut tournament
  let champion = awardsMap['Galactic Champion'] || null;
  if (!champion || champion.length === 0) {
    const live = await computeChampion(DB, seasonId);
    champion = live.length > 0 ? assignStandardRanks(live) : null;
  } else {
    champion = assignStandardRanks(champion);
  }

  // Season participation aggregate
  const participation = await getSeasonParticipation(DB, seasonId);

  // Resolve player names on all award lists
  schemer = resolveNames(schemer, nameMap);
  ambassador = resolveNames(ambassador, nameMap);
  ruler = resolveNames(ruler, nameMap);
  champion = resolveNames(champion, nameMap);
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
  champion = formatScore(champion, (e) => e.score ? `🏆` : null);
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
    champion,
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
  return items
    .map(item => {
      const formatted = formatter(item);
      return formatted ? { ...item, score: formatted } : null;
    })
    .filter(item => item !== null);
}
