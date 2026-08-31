/**
 * Shared spreadsheet fixtures for the backend test suite.
 */

// A small but meaningful league: 2 seasons, 4 players, 3 leaders,
// votes in Season 1 week 2 (one player already submitted).
function basicTables() {
  return {
    Settings: [
      ['KEY', 'VALUE'],
      ['ACTIVE_SEASON_ID', 'S2'],
      ['CURRENT_WEEK', 'Week 3'],
      ['VOTING_OPEN', 'TRUE']
    ],
    Seasons: [
      ['ID', 'NAME'],
      ['S1', 'Season 1'],
      ['S2', 'Season 2']
    ],
    Players: [
      ['ID', 'NAME', 'MELEE', 'EMAIL', 'ACTIVE'],
      ['p1', 'Alice', 'MAlice', 'alice@x.com', 'TRUE'],
      ['p2', 'Bob', 'MBob', 'bob@x.com', 'TRUE'],
      ['p3', 'Cara', 'MCara', '', 'TRUE'],
      ['p4', 'Dan', 'MDan', '', 'TRUE'],
      ['p5', 'Inactive', 'MInactive', 'old@x.com', 'FALSE']
    ],
    Leaders: [
      ['ID', 'NAME', 'SET', 'ACTIVE'],
      ['l1', 'Leia Organa', 'L', 'TRUE'],
      ['l2', 'Han Solo', 'R', 'TRUE'],
      ['l3', 'Jyn Erso', 'R', 'TRUE'],
      ['l4', 'Old Leader', 'X', 'FALSE']
    ],
    LeaderVotes: [
      // timestamp, seasonId, week, playerId, leaderId
      ['TS', 'SEASON_ID', 'WEEK', 'PLAYER_ID', 'LEADER_ID'],
      ['2026-01-01', 'S1', 2, 'p1', 'l1'],
      ['2026-01-01', 'S1', 2, 'p2', 'l2'],
      ['2026-01-01', 'S1', 2, 'p1', 'l2']
    ],
    OpponentVotes: [
      // timestamp, seasonId, week, opponentId (tally only, de-identified)
      ['TS', 'SEASON_ID', 'WEEK', 'OPPONENT_ID'],
      ['2026-01-01', 'S1', 2, 'p2'],
      ['2026-01-01', 'S1', 2, 'p1']
    ],
    Awards: [
      ['SEASON_ID', 'AWARD', 'PLAYER_ID', 'NAME', 'NOTE', 'DATE']
    ]
  };
}

module.exports = { basicTables };
