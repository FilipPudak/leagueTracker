import { parseMatchResult } from './careerStats.js';

const TIER_THRESHOLDS = {
  nightWins:       { bronze: 5,  silver: 15, gold: 30 },
  undefeatedNights:{ bronze: 1,  silver: 3,  gold: 5 },
  attendance:      { bronze: 10, silver: 25, gold: 50 },
  leaderVariety:   { bronze: 3,  silver: 6,  gold: 10 },
  sweepMaster:     { bronze: 5,  silver: 15, gold: 30 },
  voter:           { bronze: 5,  silver: 10, gold: 20 },
};

function tierFor(value, thresholds) {
  if (value >= thresholds.gold)   return 'gold';
  if (value >= thresholds.silver) return 'silver';
  if (value >= thresholds.bronze) return 'bronze';
  return null;
}

function nextTierInfo(value, thresholds) {
  if (value < thresholds.bronze) return { nextTier: 'bronze', nextThreshold: thresholds.bronze };
  if (value < thresholds.silver) return { nextTier: 'silver', nextThreshold: thresholds.silver };
  if (value < thresholds.gold)   return { nextTier: 'gold', nextThreshold: thresholds.gold };
  return { nextTier: null, nextThreshold: null };
}

export async function computeBadges(db, playerId, activeSeasonId = null, isSeasonActive = false) {
  const [attendanceRows, standingsRows, matchRows, votesRows, votesReceivedRows, leaderCount, champAsP1, champAsP2] = await Promise.all([
    db.prepare("SELECT a.season_id, a.week FROM attendance a JOIN melee_tournaments t ON t.season_id = a.season_id AND t.round = a.week WHERE a.player_id = ? AND t.phase = 'regular'").bind(playerId).all(),
    db.prepare('SELECT season_id, round, wins, losses, rank FROM season_standings WHERE player_id = ?').bind(playerId).all(),
    db.prepare(
      `SELECT player1_id, player2_id, winner_id, result, is_bye, season_id, round FROM match_results
       WHERE player1_id = ? OR player2_id = ?`
    ).bind(playerId, playerId).all(),
    db.prepare('SELECT season_id, week, leader_id FROM votes WHERE player_id = ?').bind(playerId).all(),
    db.prepare(
      'SELECT season_id, COUNT(DISTINCT player_id) as cnt FROM votes WHERE opponent_id = ? GROUP BY season_id'
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
  const votes = votesRows.results || [];
  const receivedVotes = votesReceivedRows.results || [];
  const distinctLeaders = (leaderCount && leaderCount.cnt) || 0;
  const beatenOpponentIds = new Set([
    ...(champAsP1.results || []).map(r => r.opponent_id),
    ...(champAsP2.results || []).map(r => r.opponent_id),
  ]);

  const hasAttendance = attendance.length > 0;
  const hasRankOne = standings.some(s => s.rank === 1);

  let crowdFavorite = false;
  for (const row of receivedVotes) {
    if (isSeasonActive && row.season_id === activeSeasonId) continue;
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

  const voteByWeekSeason = new Map(votes.map(v => [`${v.season_id}-${v.week}`, v.leader_id]));
  let hasDeckMaster = false;
  const seasonIds = [...new Set(matches.map(m => m.season_id))];
  for (const sid of seasonIds) {
    const leaderWinCount = new Map();
    for (const m of matches) {
      if (m.season_id !== sid) continue;
      if (m.is_bye) continue;
      if (m.winner_id !== playerId) continue;
      const leaderId = voteByWeekSeason.get(`${sid}-${m.round}`);
      if (leaderId) leaderWinCount.set(leaderId, (leaderWinCount.get(leaderId) || 0) + 1);
    }
    let leadersWithThreeWins = 0;
    for (const count of leaderWinCount.values()) {
      if (count >= 3) leadersWithThreeWins++;
    }
    if (leadersWithThreeWins >= 6) { hasDeckMaster = true; break; }
  }

  const totalVotes = votes.length;

  return [
    {
      id: 'firstNight',
      name: 'First Night',
      type: 'flat',
      earned: hasAttendance,
      icon: 'spacecraft',
      tooltip: 'Attend your first league night',
    },
    {
      id: 'nightChampion',
      name: 'Conqueror',
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
      icon: 'rebel',
      tooltip: 'Receive 3+ favorite opponent votes from different players in a completed season',
    },
    {
      id: 'loyalist',
      name: 'Loyalist',
      type: 'flat',
      earned: loyalist,
      icon: 'shield-star',
      tooltip: 'Attend 3 consecutive seasons',
    },
    {
      id: 'deckMaster',
      name: 'Deck Master',
      type: 'flat',
      earned: hasDeckMaster,
      icon: 'cards',
      tooltip: 'Win 3+ matches each with 6 different leaders in a single season',
    },
    {
      id: 'nightWins',
      name: 'Night Wins',
      type: 'tiered',
      value: totalWins,
      tier: tierFor(totalWins, TIER_THRESHOLDS.nightWins),
      ...nextTierInfo(totalWins, TIER_THRESHOLDS.nightWins),
      earned: totalWins >= TIER_THRESHOLDS.nightWins.bronze,
      icon: 'lightsaber',
      tooltip: 'Win matches across league nights — Bronze: 5, Silver: 15, Gold: 30',
    },
    {
      id: 'cleanSheet',
      name: 'Clean Sheet',
      type: 'tiered',
      value: undefeatedNights,
      tier: tierFor(undefeatedNights, TIER_THRESHOLDS.undefeatedNights),
      ...nextTierInfo(undefeatedNights, TIER_THRESHOLDS.undefeatedNights),
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
      ...nextTierInfo(attendance.length, TIER_THRESHOLDS.attendance),
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
      ...nextTierInfo(distinctLeaders, TIER_THRESHOLDS.leaderVariety),
      earned: distinctLeaders >= TIER_THRESHOLDS.leaderVariety.bronze,
      icon: 'medal',
      tooltip: 'Play different leaders — Bronze: 3, Silver: 6, Gold: 10',
    },
    {
      id: 'sweepMaster',
      name: 'Sweep Master',
      type: 'tiered',
      value: sweepCount,
      tier: tierFor(sweepCount, TIER_THRESHOLDS.sweepMaster),
      ...nextTierInfo(sweepCount, TIER_THRESHOLDS.sweepMaster),
      earned: sweepCount >= TIER_THRESHOLDS.sweepMaster.bronze,
      icon: 'crossed-lightsabers',
      tooltip: 'Win matches 2-0 — Bronze: 5, Silver: 15, Gold: 30',
    },
    {
      id: 'voter',
      name: 'Voter',
      type: 'tiered',
      value: totalVotes,
      tier: tierFor(totalVotes, TIER_THRESHOLDS.voter),
      ...nextTierInfo(totalVotes, TIER_THRESHOLDS.voter),
      earned: totalVotes >= TIER_THRESHOLDS.voter.bronze,
      icon: 'ballot',
      tooltip: 'Submit votes — Bronze: 5, Silver: 10, Gold: 20',
    },
  ];
}
