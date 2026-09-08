import { computeSeasonTable } from '../lib/seasonTable.js';

export async function handleGetStandingsData(body, env) {
  const { DB } = env;
  const { seasonId, asOfRound } = body;

  if (!seasonId) {
    const err = new Error('seasonId is required');
    err.status = 400;
    throw err;
  }

  const tournaments = await DB.prepare(
    'SELECT melee_id, round, name, date, phase FROM melee_tournaments WHERE season_id = ? ORDER BY round, melee_id'
  ).bind(seasonId).all();
  const tournamentList = tournaments.results || [];

  let latestRegularRound = 0;
  for (const t of tournamentList) {
    if (t.phase === 'regular' && t.round > latestRegularRound) {
      latestRegularRound = t.round;
    }
  }
  const effectiveAsOf = asOfRound || latestRegularRound;

  const standings = await DB.prepare(
    'SELECT round, player_id, wins, losses, draws, match_points, rank FROM season_standings WHERE season_id = ? AND round <= ?'
  ).bind(seasonId, effectiveAsOf).all();
  const standingsList = standings.results || [];

  const season = await DB.prepare('SELECT length, top_results FROM seasons WHERE id = ?').bind(seasonId).first();
  const topResults = season?.top_results || 7;

  const nights = standingsList.map(s => ({
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
    if (t.round > effectiveAsOf) continue;
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

  for (const s of standingsList) {
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

  const rounds = [...roundMap.values()].sort((a, b) => a.round - b.round);

  return {
    table,
    rounds,
    asOfRound: effectiveAsOf,
  };
}
