import { computeSeasonTable } from './seasonTable.js';
import { PHASE, DEFAULT_TOP_RESULTS } from './constants.js';

export function buildPlayerSeasonSection({ playerId, seasonStandings, tournaments, attendanceCount, totalNights, topResults, leaders, awards }) {
  const regularRounds = new Set(
    (tournaments || []).filter(t => t.phase === PHASE.REGULAR).map(t => t.round)
  );
  const regularStandings = (seasonStandings || []).filter(s => regularRounds.has(s.round));

  const nights = regularStandings
    .filter(s => s.player_id === playerId)
    .map(s => ({
      round: s.round,
      wins: s.wins || 0,
      draws: s.draws || 0,
      losses: s.losses || 0,
      points: (s.wins || 0) * 3 + (s.draws || 0),
      rank: s.rank,
    }))
    .sort((a, b) => a.round - b.round);

  const entries = regularStandings.map(s => ({
    playerId: s.player_id,
    round: s.round,
    wins: s.wins || 0,
    draws: s.draws || 0,
    losses: s.losses || 0,
    rank: s.rank,
  }));
  const table = computeSeasonTable(entries, topResults || DEFAULT_TOP_RESULTS);
  const row = table.find(r => r.playerId === playerId);

  return {
    rank: row ? row.rank : null,
    points: row ? row.points : 0,
    nightsAttended: attendanceCount || 0,
    totalNights: totalNights || 0,
    played: row ? row.played : 0,
    won: row ? row.won : 0,
    drawn: row ? row.drawn : 0,
    lost: row ? row.lost : 0,
    nights,
    leaders: leaders || [],
    awards: awards || [],
  };
}

export async function loadPlayerSeasonSection(DB, playerId, seasonId) {
  const [standingsResult, tournamentsResult, attendanceResult, totalNightsResult, seasonRow] = await Promise.all([
    DB.prepare('SELECT season_id, round, player_id, wins, losses, draws, rank FROM season_standings WHERE season_id = ?').bind(seasonId).all(),
    DB.prepare('SELECT round, phase FROM melee_tournaments WHERE season_id = ?').bind(seasonId).all(),
    DB.prepare('SELECT COUNT(*) as cnt FROM attendance a JOIN melee_tournaments t ON t.season_id = a.season_id AND t.round = a.week WHERE a.season_id = ? AND a.player_id = ? AND t.phase = ?').bind(seasonId, playerId, PHASE.REGULAR).first(),
    DB.prepare('SELECT COUNT(DISTINCT round) as cnt FROM melee_tournaments WHERE season_id = ? AND phase = ?').bind(seasonId, PHASE.REGULAR).first(),
    DB.prepare('SELECT top_results FROM seasons WHERE id = ?').bind(seasonId).first(),
  ]);

  return buildPlayerSeasonSection({
    playerId,
    seasonStandings: standingsResult.results || [],
    tournaments: tournamentsResult.results || [],
    attendanceCount: attendanceResult ? attendanceResult.cnt : 0,
    totalNights: totalNightsResult ? totalNightsResult.cnt : 0,
    topResults: (seasonRow && seasonRow.top_results) || DEFAULT_TOP_RESULTS,
  });
}
