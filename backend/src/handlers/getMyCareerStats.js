import { getSetting, getAllStandings, parseSeasonId, parseWeek } from '../db/queries.js';
import { buildRivalry, buildCareerRecord, buildFinalsRecord, buildSeasonProgression } from '../lib/careerStats.js';
import { nightKey, buildRoundCountByNight } from '../lib/nights.js';
import { computeBadges } from '../lib/badges.js';
import { PHASE } from '../lib/constants.js';

export async function handleGetMyCareerStats(body, env, session) {
  const { DB } = env;

  if (!session) {
    const err = new Error('Session expired. Please re-link to continue.');
    err.status = 401;
    throw err;
  }

  const playerId = session.player_id;
  const activeSeasonId = parseSeasonId(await getSetting(DB, 'ACTIVE_SEASON_ID'));
  const currentWeek = parseWeek(await getSetting(DB, 'CURRENT_WEEK'));

  const allStandings = await getAllStandings(DB);

  const MATCH_COLS = 'season_id, round, player1_id, player2_id, winner_id, result, is_bye';
  const asP1 = await DB.prepare(`SELECT ${MATCH_COLS} FROM match_results WHERE player1_id = ?`).bind(playerId).all();
  const asP2 = await DB.prepare(`SELECT ${MATCH_COLS} FROM match_results WHERE player2_id = ?`).bind(playerId).all();
  const myMatches = [...(asP1.results || []), ...(asP2.results || [])];

  const tournamentsResult = await DB.prepare(
    'SELECT season_id, round, phase FROM melee_tournaments'
  ).all();
  const regularRoundsBySeason = new Map();
  const finalNights = new Set();
  for (const t of tournamentsResult.results || []) {
    if (t.phase !== PHASE.REGULAR) {
      finalNights.add(nightKey(t.season_id, t.round));
      continue;
    }
    if (!regularRoundsBySeason.has(t.season_id)) regularRoundsBySeason.set(t.season_id, new Set());
    regularRoundsBySeason.get(t.season_id).add(t.round);
  }
  const isFinalNight = row => finalNights.has(nightKey(row.season_id, row.round));

  const seasonsResult = await DB.prepare(
    'SELECT id, name, length, top_results FROM seasons ORDER BY id'
  ).all();
  const seasons = seasonsResult.results || [];

  const playersResult = await DB.prepare('SELECT id, name FROM players').all();
  const namesById = new Map((playersResult.results || []).map(p => [p.id, p.name]));

  const myRegularStandings = allStandings.filter(s => s.player_id === playerId && !isFinalNight(s));
  const myFinalStandings = allStandings.filter(s => s.player_id === playerId && isFinalNight(s));
  const myRegularMatches = myMatches.filter(m => !isFinalNight(m));
  const myFinalMatches = myMatches.filter(isFinalNight);

  const rivalry = buildRivalry(myMatches, playerId, namesById);
  const record = buildCareerRecord(myRegularStandings, myRegularMatches, playerId, buildRoundCountByNight(allStandings));
  const finals = buildFinalsRecord(myFinalStandings, myFinalMatches, playerId);
  const { progression, peak } = buildSeasonProgression({
    seasons, allStandings, regularRoundsBySeason, playerId, activeSeasonId,
  });

  const currentSeason = progression.find(p => p.isCurrent);
  if (currentSeason && currentSeason.rank != null && Number.isFinite(currentWeek)) {
    const roundsWithData = [...(regularRoundsBySeason.get(activeSeasonId) || [])]
      .filter(r => allStandings.some(s => s.season_id === activeSeasonId && s.round === r));
    currentSeason.asOfRound = roundsWithData.length ? Math.max(...roundsWithData) : null;
  }

  const hasCareerData = record.nights > 0 || record.matches.played > 0 ||
    finals.nights > 0 || finals.matches.played > 0;

  const badges = await computeBadges(DB, playerId, activeSeasonId, currentWeek !== null, { standings: allStandings });

  return { hasCareerData, rivalry, record, finals, progression, peak, activeSeasonId, badges };
}
