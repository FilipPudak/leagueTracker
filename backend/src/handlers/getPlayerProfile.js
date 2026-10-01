import { getSetting, parseSeasonId, parseWeek, getPlayerById, getAwardsForSeason } from '../db/queries.js';
import { buildCareerRecord, buildSeasonProgression, computeLeaderWinRates } from '../lib/careerStats.js';
import { computeBadges } from '../lib/badges.js';
import { computeSeasonTable } from '../lib/seasonTable.js';
import { badRequest } from '../lib/errors.js';
import { AWARD, PHASE, DEFAULT_TOP_RESULTS } from '../lib/constants.js';

// Explicit seasonId wins; missing/empty falls back to the active season.
function resolveSeasonId(rawSeasonId, activeSeasonId) {
  const hasSeasonParam = rawSeasonId !== undefined && rawSeasonId !== null && rawSeasonId !== '';
  if (!hasSeasonParam) {
    if (!activeSeasonId) {
      const err = new Error('No active season.');
      err.status = 400;
      throw err;
    }
    return activeSeasonId;
  }
  const sid = parseSeasonId(rawSeasonId);
  if (sid == null) throw badRequest('Invalid seasonId.');
  return sid;
}

// Season-section assembly: derived rank/points + night tiles + leader rows.
function buildSeasonSection(playerRow, seasonStandings, nightsAttended, totalNights, leaders, awardsWon) {
  const nights = seasonStandings.map(s => ({
    round: s.round,
    wins: s.wins || 0,
    draws: s.draws || 0,
    losses: s.losses || 0,
    points: (s.wins || 0) * 3 + (s.draws || 0),
    rank: s.rank,
  }));
  return {
    rank: playerRow ? playerRow.rank : null,
    points: playerRow ? playerRow.points : 0,
    nightsAttended,
    totalNights,
    played: playerRow ? playerRow.played : 0,
    won: playerRow ? playerRow.won : 0,
    drawn: playerRow ? playerRow.drawn : 0,
    lost: playerRow ? playerRow.lost : 0,
    nights,
    leaders,
    awards: awardsWon,
  };
}

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
  const sid = resolveSeasonId(seasonId, activeSeasonId);
  const isCurrentSeason = sid === activeSeasonId;

  const [seasonStandingsResult, seasonTournamentsResult, leadersRaw, deckWinRates, nightsAttendedResult, totalNightsResult, seasonRow, allSeasonStandingsResult, championTitleRows, rulerTitleRows] = await Promise.all([
    DB.prepare('SELECT season_id, round, player_id, wins, losses, draws, rank FROM season_standings WHERE season_id = ? AND player_id = ?').bind(sid, playerId).all(),
    DB.prepare('SELECT round, phase FROM melee_tournaments WHERE season_id = ?').bind(sid).all(),
    DB.prepare(`
      SELECT l.id, l.name, l."set", COUNT(v.id) as play_count
      FROM votes v
      JOIN leaders l ON v.leader_id = l.id
      WHERE v.season_id = ? AND v.player_id = ?
      GROUP BY l.id, l.name, l."set"
      ORDER BY play_count DESC
    `).bind(sid, playerId).all(),
    computeLeaderWinRates(DB, playerId, sid),
    DB.prepare("SELECT COUNT(*) as cnt FROM attendance a JOIN melee_tournaments t ON t.season_id = a.season_id AND t.round = a.week WHERE a.season_id = ? AND a.player_id = ? AND t.phase = ?").bind(sid, playerId, PHASE.REGULAR).first(),
    DB.prepare("SELECT COUNT(DISTINCT round) as cnt FROM melee_tournaments WHERE season_id = ? AND phase = ?").bind(sid, PHASE.REGULAR).first(),
    DB.prepare('SELECT top_results FROM seasons WHERE id = ?').bind(sid).first(),
    DB.prepare('SELECT season_id, round, player_id, wins, losses, draws, rank FROM season_standings WHERE season_id = ?').bind(sid).all(),
    DB.prepare('SELECT season_id FROM awards WHERE award_name = ? AND player_id = ?').bind(AWARD.CHAMPION, playerId).all(),
    DB.prepare('SELECT DISTINCT season_id FROM awards WHERE award_name = ? AND player_id = ? AND rank = 1').bind(AWARD.RULER, playerId).all(),
  ]);

  const regularRoundSet = new Set(
    (seasonTournamentsResult.results || []).filter(t => t.phase === PHASE.REGULAR).map(t => t.round)
  );
  const seasonStandings = (seasonStandingsResult.results || []).filter(s => regularRoundSet.has(s.round));

  const leaders = buildLeaderRows(leadersRaw.results, deckWinRates);
  const awardsWon = await loadAwardsWon(DB, sid, playerId, isCurrentSeason);
  const nightsAttended = nightsAttendedResult ? nightsAttendedResult.cnt : 0;
  const totalNights = totalNightsResult ? totalNightsResult.cnt : 0;
  const topResults = (seasonRow && seasonRow.top_results) || DEFAULT_TOP_RESULTS;
  const allSeasonStandings = (allSeasonStandingsResult.results || []).filter(s => regularRoundSet.has(s.round));

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
  const season = buildSeasonSection(playerRow, seasonStandings, nightsAttended, totalNights, leaders, awardsWon);

  const { record, progression, peak } = await loadCareerData(DB, playerId, activeSeasonId);

  const badges = await computeBadges(DB, playerId, activeSeasonId, currentWeek !== null);
  const earnedBadges = badges.filter(b => b.earned);

  const championCount = (championTitleRows.results || []).length;
  const rulerCount = (rulerTitleRows.results || []).length;

  return {
    playerId,
    playerName: player.name,
    season,
    career: {
      nightsPlayed: record.nights,
      totalWDLL: { won: record.matches.wins, drawn: record.matches.draws, lost: record.matches.losses },
      gameDiff: record.gameDiff,
      avgPtsPerNight: record.avgPtsPerNight,
      progression,
      peak,
      badges: earnedBadges,
      championCount,
      rulerCount,
    },
  };
}

// Leaders used this season with the win ledger attributed from votes
// (the app's only deck signal).
function buildLeaderRows(rawRows, deckWinRates) {
  return (rawRows || []).map(r => {
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
}

// Awards won are revealed only for closed seasons: mid-season a leader is
// "in the lead", never a winner. Top-of-podium = max score for that award.
async function loadAwardsWon(DB, sid, playerId, isCurrentSeason) {
  if (isCurrentSeason) return [];
  const awards = await getAwardsForSeason(DB, sid);
  const allAwards = awards.results || [];
  return allAwards
    .filter(a => {
      if (a.player_id !== playerId) return false;
      const maxScore = Math.max(...allAwards
        .filter(x => x.award_name === a.award_name)
        .map(x => x.score ?? 0));
      return (a.score ?? 0) === maxScore;
    })
    .map(a => ({ award_name: a.award_name, score: a.score }));
}

// Career aggregates over ALL regular-phase nights across all seasons.
async function loadCareerData(DB, playerId, activeSeasonId) {
  const MATCH_COLS = 'season_id, round, player1_id, player2_id, winner_id, result, is_bye';
  const [allStandingsResult, allMatchAsP1, allMatchAsP2, tournamentsResult, seasonsResult] = await Promise.all([
    DB.prepare('SELECT season_id, round, player_id, wins, losses, draws, rank FROM season_standings').all(),
    DB.prepare(`SELECT ${MATCH_COLS} FROM match_results WHERE player1_id = ?`).bind(playerId).all(),
    DB.prepare(`SELECT ${MATCH_COLS} FROM match_results WHERE player2_id = ?`).bind(playerId).all(),
    DB.prepare('SELECT season_id, round FROM melee_tournaments WHERE phase = ?').bind(PHASE.REGULAR).all(),
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
  return { record, progression, peak };
}