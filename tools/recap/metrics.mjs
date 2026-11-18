import { computeSeasonTable } from '../../backend/src/lib/seasonTable.js';

export const ASPECTS = ['Aggression', 'Command', 'Cunning', 'Vigilance', 'Heroism', 'Villainy'];

export function parseAspects(raw) {
  const list = Array.isArray(raw) ? raw : String(raw || '').split(',');
  return [...new Set(list.map((a) => a.trim()).filter((a) => ASPECTS.includes(a)))].slice(0, 2);
}

export function buildSeasonTable(standings, players, topResults) {
  const entries = standings.map((r) => ({
    playerId: r.player_id,
    round: r.round,
    season_id: r.season_id,
    wins: r.wins,
    draws: r.draws,
    losses: r.losses,
    rank: r.rank,
  }));
  const names = new Map(players.map((p) => [p.id, p.name || p.melee_name || p.id]));
  return computeSeasonTable(entries, topResults).map((row) => ({ ...row, name: names.get(row.playerId) || row.playerId }));
}

export function matchTotal(standings) {
  const played = standings.reduce((sum, r) => sum + (r.wins || 0) + (r.draws || 0) + (r.losses || 0), 0);
  return Math.round(played / 2);
}

export function leaderPicks(votes) {
  const byLeader = new Map();
  for (const vote of votes) {
    const key = `${vote.name}|${vote.set}`;
    const row = byLeader.get(key) || { name: vote.name, set: vote.set, aspects: parseAspects(vote.aspects), count: 0 };
    row.count += 1;
    byLeader.set(key, row);
  }
  return [...byLeader.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function aspectBreakdown(picks) {
  const slots = Object.fromEntries(ASPECTS.map((a) => [a, 0]));
  const sets = {};
  const outsiders = new Map();
  let heroism = 0;
  let villainy = 0;
  let neither = 0;
  for (const pick of picks) {
    for (const aspect of pick.aspects) slots[aspect] += pick.count;
    const hasHeroism = pick.aspects.includes('Heroism');
    const hasVillainy = pick.aspects.includes('Villainy');
    if (hasHeroism) heroism += pick.count;
    if (hasVillainy) villainy += pick.count;
    if (!hasHeroism && !hasVillainy) {
      const label = `${pick.name} (${pick.set})`;
      neither += pick.count;
      outsiders.set(label, (outsiders.get(label) || 0) + pick.count);
    }
    sets[pick.set] = (sets[pick.set] || 0) + pick.count;
  }
  return {
    slots,
    sets,
    heroism,
    villainy,
    neither,
    outsiders: [...outsiders.entries()].map(([label, count]) => ({ label, count })),
    total: picks.reduce((sum, pick) => sum + pick.count, 0),
  };
}

export function leaderPerformance(votes, standings) {
  const index = new Map(standings.map((r) => [`${r.player_id}#${r.round}`, r]));
  const byLeader = new Map();
  for (const vote of votes) {
    const row = index.get(`${vote.player_id}#${vote.week}`);
    if (!row) continue;
    const key = `${vote.name}|${vote.set}`;
    const agg = byLeader.get(key) || {
      name: vote.name,
      set: vote.set,
      aspects: parseAspects(vote.aspects),
      picks: 0,
      won: 0,
      drawn: 0,
      lost: 0,
    };
    agg.picks += 1;
    agg.won += row.wins || 0;
    agg.drawn += row.draws || 0;
    agg.lost += row.losses || 0;
    byLeader.set(key, agg);
  }
  return [...byLeader.values()]
    .map((agg) => {
      const matches = agg.won + agg.drawn + agg.lost;
      return { ...agg, matches, winRate: matches ? agg.won / matches : 0 };
    })
    .sort((a, b) => b.winRate - a.winRate || b.picks - a.picks || a.name.localeCompare(b.name));
}

export function awardLeaders(rows, name) {
  const list = rows.filter((r) => r.award_name === name);
  if (!list.length) return null;
  const best = Math.max(...list.map((r) => r.score || 0));
  return { score: best, playerIds: list.filter((r) => (r.score || 0) === best).map((r) => r.player_id) };
}
