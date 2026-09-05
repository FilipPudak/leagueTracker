// Voting compliance, streaks, and raffle tickets

// Get player's voting compliance for a season
export async function getCompliance(db, seasonId, playerId) {
  const row = await db.prepare(`
    SELECT
      COUNT(DISTINCT lv.week) as weeks_voted,
      COUNT(DISTINCT a.week) as weeks_attended
    FROM attendance a
    LEFT JOIN leader_votes lv
      ON lv.season_id = a.season_id
      AND lv.week = a.week
      AND lv.player_id = a.player_id
    WHERE a.season_id = ? AND a.player_id = ?
  `).bind(seasonId, playerId).first();

  const voted = row?.weeks_voted || 0;
  const attended = row?.weeks_attended || 0;
  const pct = attended > 0 ? Math.round((voted / attended) * 1000) / 10 : 0;

  return { weeksVoted: voted, weeksAttended: attended, compliancePct: pct };
}

// Get player's current and best voting streak for a season
export async function getStreaks(db, seasonId, playerId) {
  // Get all weeks this player attended, ordered
  const attendedWeeks = await db.prepare(`
    SELECT DISTINCT week FROM attendance
    WHERE season_id = ? AND player_id = ?
    ORDER BY week
  `).bind(seasonId, playerId).all();

  if (!attendedWeeks.results || attendedWeeks.results.length === 0) {
    return { currentStreak: 0, bestStreak: 0 };
  }

  // Get all weeks this player voted
  const votedWeeks = await db.prepare(`
    SELECT DISTINCT week FROM leader_votes
    WHERE season_id = ? AND player_id = ?
  `).bind(seasonId, playerId).all();

  const votedSet = new Set((votedWeeks.results || []).map(r => r.week));

  // Calculate streaks
  let currentStreak = 0;
  let bestStreak = 0;
  let tempStreak = 0;

  // Iterate from most recent to oldest for current streak
  const weeks = attendedWeeks.results.map(r => r.week);

  // Current streak: count consecutive voted weeks from the most recent backwards
  for (let i = weeks.length - 1; i >= 0; i--) {
    if (votedSet.has(weeks[i])) {
      currentStreak++;
    } else {
      break;
    }
  }

  // Best streak: longest consecutive run of voted weeks
  tempStreak = 0;
  for (const week of weeks) {
    if (votedSet.has(week)) {
      tempStreak++;
      if (tempStreak > bestStreak) bestStreak = tempStreak;
    } else {
      tempStreak = 0;
    }
  }

  return { currentStreak, bestStreak };
}

// Get player's raffle ticket count for a season
export async function getRaffleTickets(db, seasonId, playerId) {
  const row = await db.prepare(`
    SELECT COUNT(*) as tickets FROM leader_votes
    WHERE season_id = ? AND player_id = ?
  `).bind(seasonId, playerId).first();
  return row?.tickets || 0;
}

// Get weekly participation count (vote tab)
export async function getWeeklyParticipation(db, seasonId, week) {
  const voted = await db.prepare(`
    SELECT COUNT(DISTINCT player_id) as count FROM leader_votes
    WHERE season_id = ? AND week = ?
  `).bind(seasonId, week).first();

  const total = await db.prepare(`
    SELECT COUNT(*) as count FROM players WHERE active = 1
  `).first();

  return {
    voted: voted?.count || 0,
    total: total?.count || 0,
  };
}

// Get season participation aggregate (leaderboard)
export async function getSeasonParticipation(db, seasonId) {
  const row = await db.prepare(`
    SELECT
      COUNT(DISTINCT a.player_id) as players_with_attendance,
      COUNT(DISTINCT lv.player_id) as players_who_voted
    FROM attendance a
    LEFT JOIN leader_votes lv
      ON a.season_id = lv.season_id AND a.player_id = lv.player_id
    WHERE a.season_id = ?
  `).bind(seasonId).first();

  const total = await db.prepare(`
    SELECT COUNT(*) as count FROM players WHERE active = 1
  `).first();

  const totalPlayers = total?.count || 0;
  const playersWithAttendance = row?.players_with_attendance || 0;
  const playersWhoVoted = row?.players_who_voted || 0;

  // Participation = % of active players who have attendance data (showed up)
  // and of those, how many voted at least once
  const participationPct = totalPlayers > 0
    ? Math.round((playersWithAttendance / totalPlayers) * 1000) / 10
    : 0;

  return { participationPct, totalPlayers, playersWhoVoted };
}
