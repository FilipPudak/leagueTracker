import { bestStreakFromWeeks, summarizeCompliance } from './participation.js';
import { MILESTONE_VOTE_TARGET } from './constants.js';

function weeksByPlayer(rows) {
  const map = new Map();
  for (const row of rows) {
    const playerId = String(row.player_id);
    if (!map.has(playerId)) map.set(playerId, new Set());
    map.get(playerId).add(row.week);
  }
  return map;
}

export function computeSeasonRewards({ players = [], votes = [], attendance = [], cutoffWeek = null }) {
  const cutoff = typeof cutoffWeek === 'number' && Number.isFinite(cutoffWeek) ? cutoffWeek : Infinity;
  const playersById = new Map(players.map(p => [String(p.id), p]));
  const votedWeeksByPlayer = weeksByPlayer(votes);
  const attendedWeeksByPlayer = weeksByPlayer(attendance);

  const rows = [];
  for (const [playerId, votedWeeks] of votedWeeksByPlayer) {
    const attendedWeeks = [...(attendedWeeksByPlayer.get(playerId) || new Set())];
    const compliance = summarizeCompliance(
      attendedWeeks.filter(w => w <= cutoff),
      votedWeeks
    );
    const player = playersById.get(playerId);
    const tickets = votedWeeks.size;

    rows.push({
      playerId,
      name: player?.name || playerId,
      active: player?.active === 1,
      tickets,
      attended: compliance.attended,
      votedInAttended: compliance.voted,
      compliancePct: compliance.pct,
      qualifies80: compliance.qualifying,
      milestoneComplete: tickets >= MILESTONE_VOTE_TARGET,
      bestStreak: bestStreakFromWeeks(
        attendedWeeks.filter(w => w < cutoff || votedWeeks.has(w)),
        votedWeeks
      ),
    });
  }

  rows.sort((a, b) => b.tickets - a.tickets || a.name.localeCompare(b.name));

  return {
    playerCount: rows.length,
    totalTickets: rows.reduce((sum, row) => sum + row.tickets, 0),
    players: rows,
  };
}
