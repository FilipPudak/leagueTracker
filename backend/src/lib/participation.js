// Voting streaks and raffle tickets

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
    SELECT DISTINCT week FROM votes
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
    SELECT COUNT(*) as tickets FROM votes
    WHERE season_id = ? AND player_id = ?
  `).bind(seasonId, playerId).first();
  return row?.tickets || 0;
}

// Get weekly participation count (vote tab)
export async function getWeeklyParticipation(db, seasonId, week) {
  const voted = await db.prepare(`
    SELECT COUNT(DISTINCT player_id) as count FROM votes
    WHERE season_id = ? AND week = ?
  `).bind(seasonId, week).first();

  const attendance = await db.prepare(`
    SELECT DISTINCT player_id FROM attendance
    WHERE season_id = ? AND week = ?
  `).bind(seasonId, week).all();

  return {
    voted: voted?.count || 0,
    total: (attendance.results || []).length,
  };
}

// Get season participation aggregate (leaderboard)
export async function getSeasonParticipation(db, seasonId) {
  const attendanceRows = await db.prepare(`
    SELECT DISTINCT player_id FROM attendance WHERE season_id = ?
  `).bind(seasonId).all();

  const votedRows = await db.prepare(`
    SELECT DISTINCT player_id FROM votes WHERE season_id = ?
  `).bind(seasonId).all();

  const totalRow = await db.prepare(`
    SELECT COUNT(*) as total_votes FROM votes WHERE season_id = ?
  `).bind(seasonId).first();

  const playersWithAttendance = (attendanceRows.results || []).length;
  const playersWhoVoted = (votedRows.results || []).length;
  const totalVotes = totalRow?.total_votes || 0;

  const participationPct = playersWithAttendance > 0
    ? Math.round((playersWhoVoted / playersWithAttendance) * 1000) / 10
    : 0;

  return { participationPct, totalPlayers: playersWithAttendance, playersWhoVoted, totalVotes };
}
