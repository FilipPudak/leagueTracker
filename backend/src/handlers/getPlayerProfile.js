import { getSetting, parseSeasonId, parseWeek, getPlayerById, getAwardsForSeason } from '../db/queries.js';
import { buildCareerRecord, buildSeasonProgression, computeDeckWinRates } from '../lib/careerStats.js';
import { computeBadges } from '../lib/badges.js';
import { computeSeasonTable } from '../lib/seasonTable.js';
import { badRequest } from '../lib/errors.js';

export async function handleGetPlayerProfile(body, env) {
  const { DB } = env;
  const { playerId, seasonId } = body;

  if (!playerId) throw badRequest('playerId is required.');

  const player = await getPlayerById(DB, playerId);
  if (!player) {
    const err = new Error('Player not found.');
    err.status = 404;
    throw err;
  }

  const activeSeasonId = parseSeasonId(await getSetting(DB, 'ACTIVE_SEASON_ID'));
  const currentWeek = parseWeek(await getSetting(DB, 'CURRENT_WEEK'));

  const hasSeasonParam = seasonId !== undefined && seasonId !== null && seasonId !== '';
  let sid = hasSeasonParam ? parseSeasonId(seasonId) : null;
  if (hasSeasonParam && sid == null) throw badRequest('Invalid seasonId.');
  if (!sid) sid = activeSeasonId;
  if (!sid) {
    const err = new Error('No active season.');
    err.status = 400;
    throw err;
  }

  const isCurrentSeason = sid === activeSeasonId;

  const MATCH_COLS = 'season_id, round, player1_id, player2_id, winner_id, result, is_bye';

  const [seasonStandingsResult, leadersRaw, deckWinRates, nightsAttendedResult, totalNightsResult, seasonRow, allSeasonStandingsResult] = await Promise.all([
    DB.prepare('SELECT season_id, round, player_id, wins, losses, draws, rank FROM season_standings WHERE season_id = ? AND player_id = ?').bind(sid, playerId).all(),
    DB.prepare(`
      SELECT l.id, l.name, l."set", COUNT(v.id) as play_count
      FROM votes v
      JOIN leaders l ON v.leader_id = l.id
      WHERE v.season_id = ? AND v.player_id = ?
      GROUP BY l.id, l.name, l."set"
      ORDER BY play_count DESC
    `).bind(sid, playerId).all(),
    computeDeckWinRates(DB, playerId, sid),
    DB.prepare("SELECT COUNT(*) as cnt FROM attendance a JOIN melee_tournaments t ON t.season_id = a.season_id AND t.round = a.week WHERE a.season_id = ? AND a.player_id = ? AND t.phase = 'regular'").bind(sid, playerId).first(),
    DB.prepare("SELECT COUNT(DISTINCT round) as cnt FROM melee_tournaments WHERE season_id = ? AND phase = 'regular'").bind(sid).first(),
    DB.prepare('SELECT top_results FROM seasons WHERE id = ?').bind(sid).first(),
    DB.prepare('SELECT season_id, round, player_id, wins, losses, draws, rank FROM season_standings WHERE season_id = ?').bind(sid).all(),
  ]);

  const seasonStandings = seasonStandingsResult.results || [];

  const leaders = (leadersRaw.results || []).map(r => {
    const deck = deckWinRates.find(d => d.leaderId === r.id);
    return {
      id: r.id,
      name: r.name,
      set: r.set,
      plays: r.play_count,
      wins: deck ? deck.wins : 0,
      losses: deck ? deck.losses : 0,
      draws: deck ? deck.draws : 0,
      winPct: deck ? deck.winPct : null,
    };
  });

  let awardsWon = [];
  if (!isCurrentSeason) {
    const awards = await getAwardsForSeason(DB, sid);
    const allAwards = awards.results || [];
    awardsWon = allAwards
      .filter(a => {
        if (a.player_id !== playerId) return false;
        const maxScore = Math.max(...allAwards
          .filter(x => x.award_name === a.award_name)
          .map(x => x.score ?? 0));
        return (a.score ?? 0) === maxScore;
      })
      .map(a => ({ award_name: a.award_name, score: a.score }));
  }

  const nightsAttended = nightsAttendedResult ? nightsAttendedResult.cnt : 0;
  const totalNights = totalNightsResult ? totalNightsResult.cnt : 0;
  const topResults = (seasonRow && seasonRow.top_results) || 7;
  const allSeasonStandings = allSeasonStandingsResult.results || [];

  const seasonTableEntries = allSeasonStandings.map(s => ({
    playerId: s.player_id,
    round: s.round,
    wins: s.wins || 0,
    draws: s.draws || 0,
    losses: s.losses || 0,
    rank: s.rank,
  }));
  const seasonTable = computeSeasonTable(seasonTableEntries, topResults);
  const playerRow = seasonTable.find(r => r.playerId === playerId);
  const seasonRank = playerRow ? playerRow.rank : null;
  const seasonPoints = playerRow ? playerRow.points : 0;

  const nights = seasonStandings.map(s => ({
    round: s.round,
    wins: s.wins || 0,
    draws: s.draws || 0,
    losses: s.losses || 0,
    points: (s.wins || 0) * 3 + (s.draws || 0),
    rank: s.rank,
  }));

  const totalW = seasonStandings.reduce((sum, s) => sum + (s.wins || 0), 0);
  const totalD = seasonStandings.reduce((sum, s) => sum + (s.draws || 0), 0);
  const totalL = seasonStandings.reduce((sum, s) => sum + (s.losses || 0), 0);

  const [allStandingsResult, allMatchAsP1, allMatchAsP2, tournamentsResult, seasonsResult] = await Promise.all([
    DB.prepare('SELECT season_id, round, player_id, wins, losses, draws, rank FROM season_standings').all(),
    DB.prepare(`SELECT ${MATCH_COLS} FROM match_results WHERE player1_id = ?`).bind(playerId).all(),
    DB.prepare(`SELECT ${MATCH_COLS} FROM match_results WHERE player2_id = ?`).bind(playerId).all(),
    DB.prepare("SELECT season_id, round FROM melee_tournaments WHERE phase = 'regular'").all(),
    DB.prepare('SELECT id, name, length, top_results FROM seasons ORDER BY id').all(),
  ]);

  const allStandings = allStandingsResult.results || [];
  const allMatches = [...(allMatchAsP1.results || []), ...(allMatchAsP2.results || [])];
  const regularRoundsBySeason = new Map();
  for (const t of tournamentsResult.results || []) {
    if (!regularRoundsBySeason.has(t.season_id)) regularRoundsBySeason.set(t.season_id, new Set());
    regularRoundsBySeason.get(t.season_id).add(t.round);
  }

  const seasons = seasonsResult.results || [];

  const myRegularStandings = allStandings.filter(s =>
    s.player_id === playerId && (regularRoundsBySeason.get(s.season_id) || new Set()).has(s.round)
  );

  const record = buildCareerRecord(myRegularStandings, allMatches, playerId);
  const { progression, peak } = buildSeasonProgression({
    seasons, allStandings, regularRoundsBySeason, playerId, activeSeasonId,
  });

  const badges = await computeBadges(DB, playerId, activeSeasonId, currentWeek !== null);
  const earnedBadges = badges.filter(b => b.earned);

  return {
    playerId,
    playerName: player.name,
    season: {
      rank: seasonRank,
      points: seasonPoints,
      nightsAttended,
      totalNights,
      played: totalW + totalD + totalL,
      won: totalW,
      drawn: totalD,
      lost: totalL,
      nights,
      leaders,
      awards: awardsWon,
    },
    career: {
      nightsPlayed: record.nights,
      totalWDLL: { won: record.matches.wins, drawn: record.matches.draws, lost: record.matches.losses },
      gameDiff: record.gameDiff,
      avgPtsPerNight: record.avgPtsPerNight,
      progression,
      peak,
      badges: earnedBadges,
    },
  };
}