// Seed data for Worker backend tests.
// Mirrors the D1 schema with realistic but minimal data.

const now = new Date().toISOString();
const recentActive = new Date(Date.now() - 1000 * 60 * 60).toISOString(); // 1 hour ago
const expiredActive = new Date(Date.now() - 1000 * 60 * 60 * 24 * 100).toISOString(); // 100 days ago (expired)

export function basicTables() {
  return {
    settings: [
      { key: 'ACTIVE_SEASON_ID', value: 'S6' },
      { key: 'CURRENT_WEEK', value: 'Week 3' },
      { key: 'VOTING_OPEN', value: 'TRUE' },
      { key: 'SEASON_LENGTH', value: '11' },
      { key: 'TIMEZONE', value: 'Europe/Stockholm' },
      { key: 'WEEKLY_DEADLINE_DAY', value: 'Wednesday' },
      { key: 'WEEKLY_DEADLINE_TIME', value: '17:45' },
    ],
    players: [
      { id: 'P001', name: 'Alice', melee_name: 'alice42', email: 'alice@test.com', active: 1 },
      { id: 'P002', name: 'Bob', melee_name: 'bob55', email: 'bob@test.com', active: 1 },
      { id: 'P003', name: 'Charlie', melee_name: 'charlie99', email: 'charlie@test.com', active: 1 },
      { id: 'P004', name: 'Diana', melee_name: 'diana77', email: null, active: 1 },
      { id: 'P005', name: 'Eve', melee_name: 'eve00', email: 'eve@test.com', active: 0 },
    ],
    leaders: [
      { id: '1', name: 'Darth Vader', set: 'JTL', active: 1 },
      { id: '2', name: 'Luke Skywalker', set: 'JTL', active: 1 },
      { id: '3', name: 'Ahsoka Tano', set: 'LOF', active: 1 },
      { id: '4', name: 'Grand Inquisitor', set: 'LOF', active: 0 },
    ],
    seasons: [
      { id: 6, name: 'Season 6', created_date: '2026-06-03' },
      { id: 5, name: 'Season 5', created_date: '2026-01-15' },
    ],
    sessions: [
      { token: 'test-token-alice', player_id: 'P001', device_id: 'dev-alice', email: 'alice@test.com', created: '2026-06-01', last_active: recentActive },
      { token: 'test-token-bob', player_id: 'P002', device_id: 'dev-bob', email: 'bob@test.com', created: '2026-06-01', last_active: recentActive },
      { token: 'test-token-expired', player_id: 'P003', device_id: 'dev-charlie', email: 'charlie@test.com', created: '2026-01-01', last_active: expiredActive },
    ],
    leader_votes: [
      { timestamp: now, season_id: 6, week: 1, player_id: 'P001', leader_id: '1' },
      { timestamp: now, season_id: 6, week: 1, player_id: 'P002', leader_id: '2' },
      { timestamp: now, season_id: 6, week: 2, player_id: 'P001', leader_id: '3' },
    ],
    opponent_votes: [
      { timestamp: now, season_id: 6, week: 1, opponent_id: 'P002' },
      { timestamp: now, season_id: 6, week: 1, opponent_id: 'P001' },
    ],
    awards: [
      { season_id: 6, award_name: 'Galactic Schemer', player_id: 'P001', score: 11 },
      { season_id: 6, award_name: 'Galactic Schemer', player_id: 'P002', score: 7 },
      { season_id: 6, award_name: 'Galactic Schemer', player_id: 'P003', score: 6 },
      { season_id: 6, award_name: 'Galactic Ambassador', player_id: 'P001', score: 6 },
      { season_id: 6, award_name: 'Galactic Ambassador', player_id: 'P002', score: 5 },
      { season_id: 6, award_name: 'Galactic Ambassador', player_id: 'P003', score: 4 },
      { season_id: 6, award_name: 'Galactic Ruler', player_id: 'P001', score: 67 },
      { season_id: 6, award_name: 'Galactic Ruler', player_id: 'P002', score: 66 },
      { season_id: 6, award_name: 'Galactic Ruler', player_id: 'P003', score: 63 },
      { season_id: 6, award_name: 'A New Hope', player_id: 'P003', score: 6 },
      { season_id: 6, award_name: 'A New Hope', player_id: 'P001', score: 4 },
      { season_id: 6, award_name: 'A New Hope', player_id: 'P002', score: 3 },
      { season_id: 6, award_name: 'Bounty Hunter', player_id: 'P002', score: 8 },
      { season_id: 6, award_name: 'Bounty Hunter', player_id: 'P004', score: 4 },
    ],
    attendance: [
      { season_id: 6, week: 1, player_id: 'P001' },
      { season_id: 6, week: 1, player_id: 'P002' },
      { season_id: 6, week: 2, player_id: 'P001' },
      { season_id: 6, week: 2, player_id: 'P002' },
      { season_id: 6, week: 2, player_id: 'P003' },
    ],
  };
}

// Minimal tables for edge case testing
export function emptyTables() {
  return {
    settings: [],
    players: [],
    leaders: [],
    seasons: [],
    sessions: [],
    leader_votes: [],
    opponent_votes: [],
    awards: [],
    attendance: [],
  };
}

// Tables with voting closed
export function closedVotingTables() {
  const t = basicTables();
  t.settings = t.settings.map(s =>
    s.key === 'VOTING_OPEN' ? { ...s, value: 'FALSE' } : s
  );
  t.settings.push({ key: 'CURRENT_WEEK', value: 'Season Ended' });
  return t;
}
