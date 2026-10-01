import { computeSeasonTable } from '../lib/seasonTable.js';
import { parseSeasonId } from '../db/queries.js';
import { badRequest } from '../lib/errors.js';
import { AWARD, PHASE, DEFAULT_TOP_RESULTS } from '../lib/constants.js';

const PHASE_DISPLAY_ORDER = { [PHASE.CUT]: 0, [PHASE.SIDE]: 1, [PHASE.REGULAR]: 2 };

export async function handleGetStandingsData(body, env) {
  const { DB } = env;
  const { seasonId: rawSeasonId, asOfRound } = body;

  if (!rawSeasonId) {
    const err = new Error('seasonId is required');
    err.status = 400;
    throw err;
  }
  const seasonId = parseSeasonId(rawSeasonId);
  if (seasonId == null) throw badRequest('Invalid seasonId.');

  const parsedAsOf = asOfRound != null ? parseInt(String(asOfRound), 10) : null;
  if (parsedAsOf !== null && (Number.isNaN(parsedAsOf) || parsedAsOf < 1)) {
    throw badRequest('Invalid asOfRound.');
  }

  const tournaments = await DB.prepare(
    'SELECT melee_id, round, name, date, phase FROM melee_tournaments WHERE season_id = ?'
  ).bind(seasonId).all();
  const tournamentList = tournaments.results || [];

  let latestRegularRound = 0;
  for (const t of tournamentList) {
    if (t.phase === PHASE.REGULAR && t.round > latestRegularRound) {
      latestRegularRound = t.round;
    }
  }
  const effectiveAsOf = parsedAsOf != null && latestRegularRound
    ? Math.min(parsedAsOf, latestRegularRound)
    : (parsedAsOf || latestRegularRound);

  const allStandings = await DB.prepare(
    'SELECT round, player_id, wins, losses, draws, match_points, rank FROM season_standings WHERE season_id = ?'
  ).bind(seasonId).all();
  const allStandingsList = allStandings.results || [];

  const season = await DB.prepare('SELECT length, top_results FROM seasons WHERE id = ?').bind(seasonId).first();
  const topResults = season?.top_results || DEFAULT_TOP_RESULTS;

  const tableStandings = allStandingsList
    .filter(s => {
      const t = tournamentList.find(x => x.round === s.round);
      return t && t.phase === PHASE.REGULAR && s.round <= effectiveAsOf;
    });

  const nights = tableStandings.map(s => ({
    playerId: s.player_id,
    round: s.round,
    wins: s.wins || 0,
    draws: s.draws || 0,
    losses: s.losses || 0,
    rank: s.rank,
  }));

  const table = computeSeasonTable(nights, topResults);

  const rounds = buildRoundSections(tournamentList, allStandingsList);

  const allRegularRounds = tournamentList
    .filter(t => t.phase === PHASE.REGULAR)
    .map(t => ({ round: t.round, name: t.name }))
    .sort((a, b) => b.round - a.round);

  const { championCounts, rulerCounts } = await loadTitleCounts(DB, seasonId);

  return {
    seasonId,
    table,
    rounds,
    allRegularRounds,
    asOfRound: effectiveAsOf,
    championCounts,
    rulerCounts,
  };
}

// Per-night sections (cut/side/regular labeled), newest first within phase.
function buildRoundSections(tournamentList, allStandingsList) {
  const roundMap = new Map();
  for (const t of tournamentList) {
    if (!roundMap.has(t.round)) {
      roundMap.set(t.round, {
        round: t.round,
        phase: t.phase,
        name: t.name,
        date: t.date,
        meleeId: t.melee_id,
        players: [],
      });
    }
  }

  for (const s of allStandingsList) {
    const roundInfo = roundMap.get(s.round);
    if (roundInfo) {
      roundInfo.players.push({
        playerId: s.player_id,
        wins: s.wins || 0,
        draws: s.draws || 0,
        losses: s.losses || 0,
        points: s.match_points || 0,
        rank: s.rank,
      });
    }
  }

  return [...roundMap.values()].sort((a, b) => {
    const pa = PHASE_DISPLAY_ORDER[a.phase] ?? 2;
    const pb = PHASE_DISPLAY_ORDER[b.phase] ?? 2;
    if (pa !== pb) return pa - pb;
    return b.round - a.round;
  });
}

// ★ = Galactic Ruler titles (other seasons only — the in-season podium already
// shows that placement); 🏆 = Galactic Champion titles (all seasons).
async function loadTitleCounts(DB, seasonId) {
  const championTitleRows = await DB.prepare(
    'SELECT player_id FROM awards WHERE award_name = ?'
  ).bind(AWARD.CHAMPION).all();
  const championCounts = {};
  for (const r of (championTitleRows.results || [])) {
    championCounts[r.player_id] = (championCounts[r.player_id] || 0) + 1;
  }

  const rulerTitleRows = await DB.prepare(
    'SELECT DISTINCT player_id FROM awards WHERE award_name = ? AND rank = 1 AND season_id != ?'
  ).bind(AWARD.RULER, seasonId).all();
  const rulerCounts = {};
  for (const r of (rulerTitleRows.results || [])) {
    rulerCounts[r.player_id] = 1;
  }

  return { championCounts, rulerCounts };
}
