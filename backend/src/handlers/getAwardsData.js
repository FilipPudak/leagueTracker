import { getSettings, getAwardsForSeason, getMostPlayedLeaders, parseSeasonId, parseWeek, isVotingOpen } from '../db/queries.js';
import { computeSchemer, computeAmbassador, computeChampion, computeNewHopeClimbers, assignStandardRanks } from '../lib/awards.js';
import { getSeasonParticipation } from '../lib/participation.js';
import { computeSeasonTable } from '../lib/seasonTable.js';
import { AWARD, PHASE, SEASON_ENDED_WEEK, DEFAULT_TOP_RESULTS, DEFAULT_SEASON_LENGTH } from '../lib/constants.js';

// As-of round for live podiums: the open voting week while a season runs,
// the final week once it has ended.
function resolveLiveRound(seasonEnded, seasonLength, votingOpen, currentWeek) {
  if (!seasonEnded && votingOpen && currentWeek) return currentWeek;
  return seasonLength;
}

const AMBASSADOR_CALLSIGNS = [
  'Gold Leader', 'Green Leader', 'Red Leader',
  'Blade Eleven', 'Rogue One', 'Phoenix Leader',
];

export async function handleGetAwardsData(body, env) {
  const { DB } = env;
  const { seasonId: requestedSeasonId } = body;

  const settings = await getSettings(DB);
  const activeSeasonId = parseSeasonId(settings.ACTIVE_SEASON_ID);
  const currentWeek = parseWeek(settings.CURRENT_WEEK);
  const votingOpen = isVotingOpen(settings.VOTING_OPEN);
  const seasonEnded = settings.CURRENT_WEEK === SEASON_ENDED_WEEK;

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
  const topLeaders = assignStandardRanks(
    (mostPlayedRaw.results || []).map(r => ({
      id: r.id, name: r.name, set: r.set, score: r.play_count,
    }))
  );

  // Schemer: live for active season (fresh between weekly refreshes), stored for past seasons
  const useLive = isActiveSeason && !seasonEnded;
  let schemer = await resolveStoredOrLive(DB, awardsMap, AWARD.SCHEMER, useLive, computeSchemer, seasonId);

  // Ambassador: same live-vs-stored rule as Schemer
  let ambassador = await resolveStoredOrLive(DB, awardsMap, AWARD.AMBASSADOR, useLive, computeAmbassador, seasonId);

  // Galactic Ruler: stored or live from the derived season table
  let ruler = await resolveRuler(DB, awardsMap, { seasonId, isActiveSeason, seasonEnded, votingOpen, currentWeek });

  // A New Hope: stored or live from season_standings
  let newHope = await resolveNewHope(DB, awardsMap, { seasonId, isActiveSeason, seasonEnded, votingOpen, currentWeek });

  // Bounty Hunter: stored only, hidden while voting is live
  let bountyHunter = isLive ? null : (awardsMap[AWARD.BOUNTY_HUNTER] || null);
  if (bountyHunter) bountyHunter = assignStandardRanks(bountyHunter);

  // Galactic Champion: stored or live from cut tournament
  let champion = awardsMap[AWARD.CHAMPION] || null;
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

  // Mask Ambassador names with callsigns while voting is live (privacy).
  // Names are already resolved from playerId above, so the masked rows drop the
  // id entirely — shipping it would let anyone re-identify the callsigns.
  maskAmbassadorCallsigns(ambassador, isLive);

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
    topLeaders,
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

// Stored-or-live podium: live computation wins while the active season's data
// is still moving; stored (materialized at close) is authoritative afterwards.
async function resolveStoredOrLive(DB, awardsMap, awardKey, useLive, liveCompute, seasonId) {
  if (useLive) {
    const live = await liveCompute(DB, seasonId);
    return live.length > 0 ? assignStandardRanks(live) : null;
  }
  const stored = awardsMap[awardKey] || null;
  return stored ? assignStandardRanks(stored) : null;
}

function maskAmbassadorCallsigns(ambassador, isLive) {
  if (!isLive || !ambassador) return;
  ambassador.forEach((entry, i) => {
    entry.name = AMBASSADOR_CALLSIGNS[i] || `Vanguard-${i + 1}`;
    delete entry.playerId;
  });
}

async function resolveRuler(DB, awardsMap, ctx) {
  const { seasonId, isActiveSeason, seasonEnded, votingOpen, currentWeek } = ctx;
  const ruler = awardsMap[AWARD.RULER] || null;
  if (ruler && ruler.length > 0) return assignStandardRanks(ruler);
  if (!isActiveSeason) return ruler ? assignStandardRanks(ruler) : null;

  const season = await DB.prepare('SELECT length, top_results FROM seasons WHERE id = ?').bind(seasonId).first();
  const seasonLength = season?.length || DEFAULT_SEASON_LENGTH;
  const topResults = season?.top_results || DEFAULT_TOP_RESULTS;
  const asOfRound = resolveLiveRound(seasonEnded, seasonLength, votingOpen, currentWeek);

  const regularRounds = await DB.prepare(
    'SELECT DISTINCT round FROM melee_tournaments WHERE season_id = ? AND phase = ?'
  ).bind(seasonId, PHASE.REGULAR).all();
  const regularRoundSet = new Set((regularRounds.results || []).map(r => r.round));

  const allStandings = await DB.prepare(
    'SELECT round, player_id, wins, losses, draws, match_points, rank FROM season_standings WHERE season_id = ?'
  ).bind(seasonId).all();

  const nights = (allStandings.results || [])
    .filter(s => regularRoundSet.has(s.round) && s.round <= asOfRound)
    .map(s => ({
      playerId: s.player_id,
      round: s.round,
      wins: s.wins || 0,
      draws: s.draws || 0,
      losses: s.losses || 0,
      rank: s.rank,
    }));

  const seasonTable = computeSeasonTable(nights, topResults);
  const top3 = seasonTable.filter(r => r.rank <= 3);
  return top3.length > 0 ? assignStandardRanks(top3.map(r => ({
    playerId: r.playerId,
    score: r.points,
    name: '',
  }))) : null;
}

async function resolveNewHope(DB, awardsMap, ctx) {
  const { seasonId, isActiveSeason, seasonEnded, votingOpen, currentWeek } = ctx;
  const newHope = awardsMap[AWARD.NEW_HOPE] || null;
  if (newHope && newHope.length > 0) return assignStandardRanks(newHope);
  if (!isActiveSeason) return newHope ? assignStandardRanks(newHope) : null;

  const season = await DB.prepare('SELECT length, top_results FROM seasons WHERE id = ?').bind(seasonId).first();
  const seasonLength = season?.length || DEFAULT_SEASON_LENGTH;
  const topResults = season?.top_results || DEFAULT_TOP_RESULTS;

  // Final: derived season table (best-X)
  const finalRound = resolveLiveRound(seasonEnded, seasonLength, votingOpen, currentWeek);
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

  const climbers = await computeNewHopeClimbers(DB, seasonId, finalRankMap, seasonLength);
  return climbers.length > 0 ? assignStandardRanks(climbers.map(c => ({
    playerId: c.playerId,
    score: c.climb,
    name: '',
  }))) : null;
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
