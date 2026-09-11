import { computeSeasonTable } from './seasonTable.js';

const WON_RE = /^(.*) won (\d+)-(\d+)-(\d+)$/;
const DRAW_RE = /^(\d+)-(\d+)-(\d+) Draw$/;

export function parseMatchResult(result) {
  if (typeof result !== 'string' || !result) return null;
  const won = result.match(WON_RE);
  if (won) return { gamesWinner: Number(won[2]), gamesLoser: Number(won[3]) };
  const draw = result.match(DRAW_RE);
  if (draw) return { gamesWinner: Number(draw[1]), gamesLoser: Number(draw[2]) };
  return null;
}

function pct(n, d) {
  return d > 0 ? Math.round((n / d) * 1000) / 10 : null;
}

export function buildRivalry(matches, playerId, names = new Map(), { minMeetings = 2, headToHeadLimit = 10 } = {}) {
  const byOpp = new Map();
  for (const m of matches) {
    if (m.is_bye) continue;
    const opp = m.player1_id === playerId ? m.player2_id : m.player1_id;
    if (!opp || opp === playerId) continue;
    const rec = byOpp.get(opp) || { opponentId: opp, played: 0, wins: 0, losses: 0, draws: 0 };
    rec.played++;
    if (m.winner_id === playerId) rec.wins++;
    else if (m.winner_id) rec.losses++;
    else rec.draws++;
    byOpp.set(opp, rec);
  }

  const h2h = [...byOpp.values()]
    .sort((a, b) => b.played - a.played || String(a.opponentId).localeCompare(String(b.opponentId)))
    .map(r => ({ ...r, name: names.get(r.opponentId) || r.opponentId }));

  const pickTop = (key) => {
    const eligible = h2h.filter(r => r.played >= minMeetings && r[key] > 0);
    if (!eligible.length) return [];
    const best = Math.max(...eligible.map(r => r[key]));
    const atKey = eligible.filter(r => r[key] === best);
    const tieKey = key === 'losses' ? 'wins' : 'losses';
    const tieFn = key === 'losses' ? Math.min : Math.max;
    const bestTie = tieFn(...atKey.map(r => r[tieKey]));
    return atKey
      .filter(r => r[tieKey] === bestTie)
      .map(r => ({ playerId: r.opponentId, name: r.name, meetings: r.played, count: r[key] }));
  };

  return {
    nemesis: pickTop('losses'),
    victim: pickTop('wins'),
    headToHead: h2h.slice(0, headToHeadLimit),
  };
}

export function buildCareerRecord(standingsRows, matches, playerId) {
  const nightKeys = new Set(standingsRows.map(s => `${s.season_id}-${s.round}`));
  const seasonSeen = new Set(standingsRows.map(s => s.season_id));

  let wins = 0, losses = 0, draws = 0;
  let gamesWon = 0, gamesLost = 0, parsed = 0, sweeps = 0;
  let undefeated = 0, totalNightPoints = 0;

  const myStandings = standingsRows.filter(s => s.player_id === playerId);
  for (const s of myStandings) {
    const nightPoints = (s.wins || 0) * 3 + (s.draws || 0);
    totalNightPoints += nightPoints;
    if ((s.losses || 0) === 0) undefeated++;
  }

  for (const m of matches) {
    const involvesMe = m.player1_id === playerId || m.player2_id === playerId;
    if (!involvesMe) continue;
    seasonSeen.add(m.season_id);
    if (m.is_bye) continue;
    const winner = m.winner_id;
    if (!winner) draws++;
    else if (winner === playerId) wins++;
    else losses++;

    const games = parseMatchResult(m.result);
    if (games) {
      parsed++;
      const myGames = winner === playerId ? games.gamesWinner : games.gamesLoser;
      const oppGames = games.gamesWinner + games.gamesLoser - myGames;
      gamesWon += myGames;
      gamesLost += oppGames;
      if (winner === playerId && oppGames === 0 && myGames >= 2) sweeps++;
    }
  }

  const played = wins + losses + draws;
  const nightCount = nightKeys.size;
  return {
    sinceSeason: seasonSeen.size ? Math.min(...seasonSeen) : null,
    nights: nightCount,
    matches: { played, wins, losses, draws },
    winPct: pct(wins, played),
    games: { won: gamesWon, lost: gamesLost, winPct: pct(gamesWon, gamesWon + gamesLost), parsed },
    sweeps: { count: sweeps, pctOfWins: pct(sweeps, wins) },
    undefeated,
    gameDiff: gamesWon - gamesLost,
    avgPtsPerNight: nightCount > 0 ? Math.round((totalNightPoints / nightCount) * 10) / 10 : 0,
  };
}

export function buildSeasonProgression({ seasons, allStandings, regularRoundsBySeason, playerId, activeSeasonId }) {
  const progression = [];
  let peak = [];

  for (const season of seasons) {
    const regular = regularRoundsBySeason.get(season.id) || new Set();
    const seasonRows = allStandings.filter(s => s.season_id === season.id && regular.has(s.round));
    const myRows = seasonRows.filter(s => s.player_id === playerId);
    const isCurrent = season.id === activeSeasonId;

    if (!myRows.length) {
      progression.push({ seasonId: season.id, name: season.name, rank: null, points: null, nightsPlayed: 0, fieldSize: null, isCurrent });
      continue;
    }

    const nights = seasonRows.map(s => ({
      playerId: s.player_id,
      round: s.round,
      wins: s.wins || 0,
      draws: s.draws || 0,
      losses: s.losses || 0,
      rank: s.rank,
    }));
    const table = computeSeasonTable(nights, season.top_results || 7);
    const mine = table.find(r => r.playerId === playerId);
    const entry = {
      seasonId: season.id,
      name: season.name,
      rank: mine ? mine.rank : null,
      points: mine ? mine.points : null,
      nightsPlayed: myRows.length,
      fieldSize: table.length,
      isCurrent,
    };
    if (entry.rank != null) {
      if (!peak.length || entry.rank < peak[0].rank) {
        peak = [{ rank: entry.rank, seasonId: entry.seasonId }];
      } else if (entry.rank === peak[0].rank) {
        peak.push({ rank: entry.rank, seasonId: entry.seasonId });
      }
    }
    progression.push(entry);
  }

  return { progression, peak };
}

export async function computeDeckWinRates(db, playerId, seasonId) {
  const [votesRows, matchRows, leaderRows] = await Promise.all([
    db.prepare(
      'SELECT week, leader_id FROM votes WHERE player_id = ? AND season_id = ?'
    ).bind(playerId, seasonId).all(),
    db.prepare(
      'SELECT round, player1_id, player2_id, winner_id, result, is_bye FROM match_results WHERE season_id = ? AND (player1_id = ? OR player2_id = ?)'
    ).bind(seasonId, playerId, playerId).all(),
    db.prepare('SELECT id, name FROM leaders').all(),
  ]);

  const votes = votesRows.results || [];
  const matches = matchRows.results || [];
  const leaders = leaderRows.results || [];

  const leaderNameMap = new Map(leaders.map(l => [l.id, l.name]));
  const voteByWeek = new Map(votes.map(v => [v.week, v.leader_id]));

  const deckMap = new Map();

  for (const m of matches) {
    if (m.is_bye) continue;
    const leaderId = voteByWeek.get(m.round);
    if (!leaderId) continue;

    const winner = m.winner_id;
    if (!winner) {
      if (!deckMap.has(leaderId)) {
        deckMap.set(leaderId, { wins: 0, losses: 0, draws: 0 });
      }
      deckMap.get(leaderId).draws++;
    } else if (winner === playerId) {
      if (!deckMap.has(leaderId)) {
        deckMap.set(leaderId, { wins: 0, losses: 0, draws: 0 });
      }
      deckMap.get(leaderId).wins++;
    } else {
      if (!deckMap.has(leaderId)) {
        deckMap.set(leaderId, { wins: 0, losses: 0, draws: 0 });
      }
      deckMap.get(leaderId).losses++;
    }
  }

  const rates = [];
  for (const [leaderId, stats] of deckMap) {
    const played = stats.wins + stats.losses + stats.draws;
    const decisions = stats.wins + stats.losses;
    rates.push({
      leaderId,
      leaderName: leaderNameMap.get(leaderId) || leaderId,
      wins: stats.wins,
      losses: stats.losses,
      draws: stats.draws,
      played,
      winPct: decisions > 0 ? Math.round((stats.wins / decisions) * 1000) / 10 : null,
    });
  }

  rates.sort((a, b) => b.played - a.played);
  return rates;
}
