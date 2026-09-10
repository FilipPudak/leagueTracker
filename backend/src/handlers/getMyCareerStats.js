import { getSetting, parseSeasonId, parseWeek } from '../db/queries.js';
import { buildRivalry, buildCareerRecord, buildSeasonProgression } from '../lib/careerStats.js';

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

  const allStandingsResult = await DB.prepare(
    'SELECT season_id, round, player_id, wins, losses, draws, rank FROM season_standings'
  ).all();
  const allStandings = allStandingsResult.results || [];

  const MATCH_COLS = 'season_id, round, player1_id, player2_id, winner_id, result, is_bye';
  const asP1 = await DB.prepare(`SELECT ${MATCH_COLS} FROM match_results WHERE player1_id = ?`).bind(playerId).all();
  const asP2 = await DB.prepare(`SELECT ${MATCH_COLS} FROM match_results WHERE player2_id = ?`).bind(playerId).all();
  const myMatches = [...(asP1.results || []), ...(asP2.results || [])];

  const tournamentsResult = await DB.prepare(
    "SELECT season_id, round FROM melee_tournaments WHERE phase = 'regular'"
  ).all();
  const regularRoundsBySeason = new Map();
  for (const t of tournamentsResult.results || []) {
    if (!regularRoundsBySeason.has(t.season_id)) regularRoundsBySeason.set(t.season_id, new Set());
    regularRoundsBySeason.get(t.season_id).add(t.round);
  }

  const seasonsResult = await DB.prepare(
    'SELECT id, name, length, top_results FROM seasons ORDER BY id'
  ).all();
  const seasons = seasonsResult.results || [];

  const playersResult = await DB.prepare('SELECT id, name FROM players').all();
  const namesById = new Map((playersResult.results || []).map(p => [p.id, p.name]));

  const myRegularStandings = allStandings.filter(s =>
    s.player_id === playerId && (regularRoundsBySeason.get(s.season_id) || new Set()).has(s.round)
  );

  const rivalry = buildRivalry(myMatches, playerId, namesById);
  const record = buildCareerRecord(myRegularStandings, myMatches, playerId);
  const { progression, peak } = buildSeasonProgression({
    seasons, allStandings, regularRoundsBySeason, playerId, activeSeasonId,
  });

  const currentSeason = progression.find(p => p.isCurrent);
  if (currentSeason && currentSeason.rank != null && Number.isFinite(currentWeek)) {
    const roundsWithData = [...(regularRoundsBySeason.get(activeSeasonId) || [])]
      .filter(r => allStandings.some(s => s.season_id === activeSeasonId && s.round === r));
    currentSeason.asOfRound = roundsWithData.length ? Math.max(...roundsWithData) : null;
  }

  const hasCareerData = record.nights > 0 || record.matches.played > 0;

  return { hasCareerData, rivalry, record, progression, peak, activeSeasonId };
}
