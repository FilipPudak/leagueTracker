// Attendance, voting streaks, raffle tickets, and weekly/season participation
import { PHASE, MILESTONE_VOTE_TARGET, COMPLIANCE_PCT } from './constants.js';

// Get player's current and best voting streak for a season
export async function getStreaks(db, seasonId, playerId) {
  const attendedWeeks = await db.prepare(`
    SELECT DISTINCT a.week FROM attendance a
    JOIN melee_tournaments t ON t.season_id = a.season_id AND t.round = a.week
    WHERE a.season_id = ? AND a.player_id = ? AND t.phase = ?
    ORDER BY a.week
  `).bind(seasonId, playerId, PHASE.REGULAR).all();

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
  let tempStreak = 0;
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

// Get voting compliance for the 80% season-end prize: votes in attended weeks
// (intersection) vs attended regular weeks whose voting window has closed.
// cutoffWeek excludes the current open week; null = all weeks (closed season).
export async function getVotingCompliance(db, seasonId, playerId, cutoffWeek = null) {
  const attendedWeeks = await db.prepare(`
    SELECT DISTINCT a.week FROM attendance a
    JOIN melee_tournaments t ON t.season_id = a.season_id AND t.round = a.week
    WHERE a.season_id = ? AND a.player_id = ? AND t.phase = ?
    ORDER BY a.week
  `).bind(seasonId, playerId, PHASE.REGULAR).all();

  const votedWeeks = await db.prepare(`
    SELECT DISTINCT week FROM votes
    WHERE season_id = ? AND player_id = ?
  `).bind(seasonId, playerId).all();

  const cutoff = typeof cutoffWeek === 'number' && Number.isFinite(cutoffWeek) ? cutoffWeek : Infinity;
  const attended = (attendedWeeks.results || []).map(r => r.week).filter(w => w < cutoff);
  const votedSet = new Set((votedWeeks.results || []).map(r => r.week).filter(w => w < cutoff));
  const voted = attended.filter(w => votedSet.has(w)).length;
  const attendedCount = attended.length;
  const pct = attendedCount > 0 ? Math.round((voted / attendedCount) * 100) : null;
  const qualifying = attendedCount > 0
    && voted >= MILESTONE_VOTE_TARGET
    && voted * 100 >= attendedCount * COMPLIANCE_PCT;

  return { attended: attendedCount, voted, pct, qualifying, target: COMPLIANCE_PCT };
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
    SELECT DISTINCT a.player_id FROM attendance a
    JOIN melee_tournaments t ON t.season_id = a.season_id AND t.round = a.week
    WHERE a.season_id = ? AND a.week = ? AND t.phase = ?
  `).bind(seasonId, week, PHASE.REGULAR).all();

  return {
    voted: voted?.count || 0,
    total: (attendance.results || []).length,
  };
}

// Tri-state attendance signal for the voting UI, mirroring validateVote's grace
// rule: null when the week has no attendance data at all (rain-out or results
// not yet synced — eligibility unknowable), true/false only once the week's
// data exists. The UI must never claim "didn't play" on null.
export async function getAttendedStatus(db, seasonId, week, playerId) {
  const weekRow = await db.prepare(
    'SELECT 1 FROM attendance WHERE season_id = ? AND week = ? LIMIT 1'
  ).bind(seasonId, week).first();
  if (!weekRow) return null;
  const mine = await db.prepare(
    'SELECT 1 FROM attendance WHERE season_id = ? AND week = ? AND player_id = ?'
  ).bind(seasonId, week, playerId).first();
  return Boolean(mine);
}

// Get season participation aggregate (leaderboard)
export async function getSeasonParticipation(db, seasonId) {
  const attendanceRows = await db.prepare(`
    SELECT DISTINCT a.player_id FROM attendance a
    JOIN melee_tournaments t ON t.season_id = a.season_id AND t.round = a.week
    WHERE a.season_id = ? AND t.phase = ?
  `).bind(seasonId, PHASE.REGULAR).all();

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
