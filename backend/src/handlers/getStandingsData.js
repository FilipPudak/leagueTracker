import { computeSeasonTable } from '../lib/seasonTable.js';
import { parseSeasonId } from '../db/queries.js';
import { badRequest } from '../lib/errors.js';

const PHASE_DISPLAY_ORDER = { cut: 0, side: 1, regular: 2 };

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

  const tournaments = await DB.prepare(
    'SELECT melee_id, round, name, date, phase FROM melee_tournaments WHERE season_id = ?'
  ).bind(seasonId).all();
  const tournamentList = tournaments.results || [];

  let latestRegularRound = 0;
  for (const t of tournamentList) {
    if (t.phase === 'regular' && t.round > latestRegularRound) {
      latestRegularRound = t.round;
    }
  }
  const effectiveAsOf = asOfRound || latestRegularRound;

  const allStandings = await DB.prepare(
    'SELECT round, player_id, wins, losses, draws, match_points, rank FROM season_standings WHERE season_id = ?'
  ).bind(seasonId).all();
  const allStandingsList = allStandings.results || [];

  const season = await DB.prepare('SELECT length, top_results FROM seasons WHERE id = ?').bind(seasonId).first();
  const topResults = season?.top_results || 7;

  const tableStandings = allStandingsList
    .filter(s => {
      const t = tournamentList.find(t => t.round === s.round);
      return t && t.phase === 'regular' && s.round <= effectiveAsOf;
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

  const rounds = [...roundMap.values()].sort((a, b) => {
    const pa = PHASE_DISPLAY_ORDER[a.phase] ?? 2;
    const pb = PHASE_DISPLAY_ORDER[b.phase] ?? 2;
    if (pa !== pb) return pa - pb;
    return b.round - a.round;
  });

  const allRegularRounds = tournamentList
    .filter(t => t.phase === 'regular')
    .map(t => ({ round: t.round, name: t.name }))
    .sort((a, b) => b.round - a.round);

  return {
    table,
    rounds,
    allRegularRounds,
    asOfRound: effectiveAsOf,
  };
}
