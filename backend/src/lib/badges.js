import { parseMatchResult } from './careerStats.js';

const TIER_THRESHOLDS = {
  nightWins:       { bronze: 5,  silver: 15, gold: 30 },
  undefeatedNights:{ bronze: 1,  silver: 3,  gold: 5 },
  attendance:      { bronze: 10, silver: 25, gold: 50 },
  leaderVariety:   { bronze: 3,  silver: 6,  gold: 10 },
  sweepMaster:     { bronze: 5,  silver: 15, gold: 30 },
};

function tierFor(value, thresholds) {
  if (value >= thresholds.gold)   return 'gold';
  if (value >= thresholds.silver) return 'silver';
  if (value >= thresholds.bronze) return 'bronze';
  return null;
}

export async function computeBadges(db, playerId) {
  const [attendanceRows, standingsRows, matchRows, votesReceived, leaderCount, champAsP1, champAsP2] = await Promise.all([
    db.prepare('SELECT season_id, week FROM attendance WHERE player_id = ?').bind(playerId).all(),
    db.prepare('SELECT season_id, round, wins, losses, rank FROM season_standings WHERE player_id = ?').bind(playerId).all(),
    db.prepare(
      `SELECT player1_id, player2_id, winner_id, result, is_bye FROM match_results
       WHERE player1_id = ? OR player2_id = ?`
    ).bind(playerId, playerId).all(),
    db.prepare(
      'SELECT season_id, COUNT(*) as cnt FROM votes WHERE opponent_id = ? GROUP BY season_id'
    ).bind(playerId).all(),
    db.prepare('SELECT COUNT(DISTINCT leader_id) as cnt FROM votes WHERE player_id = ?').bind(playerId).first(),
    db.prepare(
      `SELECT DISTINCT player1_id as opponent_id FROM match_results
       WHERE winner_id = ? AND player2_id IS NOT NULL AND is_bye = 0`
    ).bind(playerId).all(),
    db.prepare(
      `SELECT DISTINCT player2_id as opponent_id FROM match_results
       WHERE winner_id = ? AND player1_id IS NOT NULL AND is_bye = 0`
    ).bind(playerId).all(),
  ]);

  const attendance = attendanceRows.results || [];
  const standings = standingsRows.results || [];
  const matches = matchRows.results || [];
  const receivedVotes = votesReceived.results || [];
  const distinctLeaders = (leaderCount && leaderCount.cnt) || 0;
  const beatenOpponentIds = new Set([
    ...(champAsP1.results || []).map(r => r.opponent_id),
    ...(champAsP2.results || []).map(r => r.opponent_id),
  ]);

  const hasAttendance = attendance.length > 0;
  const hasRankOne = standings.some(s => s.rank === 1);

  let crowdFavorite = false;
  for (const row of receivedVotes) {
    if (row.cnt >= 3) { crowdFavorite = true; break; }
  }

  const seasons = [...new Set(attendance.map(a => a.season_id))].sort((a, b) => a - b);
  let loyalist = false;
  if (seasons.length >= 3) {
    for (let i = 2; i < seasons.length; i++) {
      if (seasons[i] - seasons[i - 1] === 1 && seasons[i - 1] - seasons[i - 2] === 1) {
        loyalist = true;
        break;
      }
    }
  }

  let giantSlayer = false;
  if (beatenOpponentIds.size > 0) {
    const champAwards = await db.prepare(
      `SELECT DISTINCT player_id FROM awards
       WHERE award_name IN ('Galactic Ruler', 'Galactic Champion')`
    ).all();
    const champPlayerIds = new Set((champAwards.results || []).map(r => r.player_id));
    for (const oppId of beatenOpponentIds) {
      if (champPlayerIds.has(oppId)) { giantSlayer = true; break; }
    }
  }

  let totalWins = 0;
  let undefeatedNights = 0;
  for (const s of standings) {
    totalWins += s.wins || 0;
    if ((s.losses || 0) === 0) undefeatedNights++;
  }

  let sweepCount = 0;
  for (const m of matches) {
    if (m.is_bye) continue;
    if (m.winner_id !== playerId) continue;
    const games = parseMatchResult(m.result);
    if (games && games.gamesLoser === 0 && games.gamesWinner >= 2) sweepCount++;
  }

  return [
    {
      id: 'firstNight',
      name: 'First Night',
      type: 'flat',
      earned: hasAttendance,
      icon: 'spacecraft-spaceship-svgrepo-com',
      tooltip: 'Attend your first league night',
    },
    {
      id: 'nightChampion',
      name: 'Night Champion',
      type: 'flat',
      earned: hasRankOne,
      icon: 'darth-vader',
      tooltip: 'Finish a night in 1st place',
    },
    {
      id: 'giantSlayer',
      name: 'Giant Slayer',
      type: 'flat',
      earned: giantSlayer,
      icon: 'boba-fett',
      tooltip: 'Beat a previous Ruler or Champion',
    },
    {
      id: 'crowdFavorite',
      name: 'Crowd Favorite',
      type: 'flat',
      earned: crowdFavorite,
      icon: 'starwars-rebel-svgrepo-com',
      tooltip: 'Receive 3+ favorite opponent votes in one season',
    },
    {
      id: 'loyalist',
      name: 'Loyalist',
      type: 'flat',
      earned: loyalist,
      icon: 'shield-star-fill-svgrepo-com',
      tooltip: 'Attend 3 consecutive seasons',
    },
    {
      id: 'nightWins',
      name: 'Night Wins',
      type: 'tiered',
      value: totalWins,
      tier: tierFor(totalWins, TIER_THRESHOLDS.nightWins),
      earned: totalWins >= TIER_THRESHOLDS.nightWins.bronze,
      icon: 'lightsaber-svgrepo-com',
      tooltip: 'Win matches across league nights — Bronze: 5, Silver: 15, Gold: 30',
    },
    {
      id: 'cleanSheet',
      name: 'Clean Sheet',
      type: 'tiered',
      value: undefeatedNights,
      tier: tierFor(undefeatedNights, TIER_THRESHOLDS.undefeatedNights),
      earned: undefeatedNights >= TIER_THRESHOLDS.undefeatedNights.bronze,
      icon: 'death-star',
      tooltip: 'Complete a night with no losses — Bronze: 1, Silver: 3, Gold: 5',
    },
    {
      id: 'attendance',
      name: 'Attendance',
      type: 'tiered',
      value: attendance.length,
      tier: tierFor(attendance.length, TIER_THRESHOLDS.attendance),
      earned: attendance.length >= TIER_THRESHOLDS.attendance.bronze,
      icon: 'stormtrooper',
      tooltip: 'Attend league nights — Bronze: 10, Silver: 25, Gold: 50',
    },
    {
      id: 'leaderVariety',
      name: 'Leader Variety',
      type: 'tiered',
      value: distinctLeaders,
      tier: tierFor(distinctLeaders, TIER_THRESHOLDS.leaderVariety),
      earned: distinctLeaders >= TIER_THRESHOLDS.leaderVariety.bronze,
      icon: 'medal-with-star-shape-svgrepo-com',
      tooltip: 'Play different leaders in votes — Bronze: 3, Silver: 6, Gold: 10',
    },
    {
      id: 'sweepMaster',
      name: 'Sweep Master',
      type: 'tiered',
      value: sweepCount,
      tier: tierFor(sweepCount, TIER_THRESHOLDS.sweepMaster),
      earned: sweepCount >= TIER_THRESHOLDS.sweepMaster.bronze,
      icon: 'lightsabers-crossed',
      tooltip: 'Win matches 2-0 — Bronze: 5, Silver: 15, Gold: 30',
    },
  ];
}
