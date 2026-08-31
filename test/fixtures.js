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
    SeasonPlayers: [
      ['SEASON_ID', 'PLAYER_ID', 'ACTIVE'],
      ['S2', 'p1', 'TRUE'],
      ['S2', 'p2', 'TRUE'],
      ['S2', 'p3', 'TRUE'],
      ['S2', 'p4', 'TRUE'],
      ['S1', 'p1', 'TRUE'],
      ['S1', 'p2', 'TRUE']
    ],
    Leaders: [
      ['ID', 'FIRST', 'LAST'],
      ['l1', 'Leia', 'Organa'],
      ['l2', 'Han', 'Solo'],
      ['l3', 'Jyn', 'Erso']
    ],
    SeasonLeaders: [
      ['SEASON_ID', 'LEADER_ID', 'ACTIVE'],
      ['S2', 'l1', 'TRUE'],
      ['S2', 'l2', 'TRUE'],
      ['S2', 'l3', 'TRUE']
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
    SeasonSummary: [
      ['DATE', 'SEASON_ID', 'WEEK', 'TOP_LEADER', 'LEADER_COUNT', 'TOP_OPPONENT', 'OPPONENT_COUNT']
    ],
    Awards: [
      ['SEASON_ID', 'AWARD', 'PLAYER_ID', 'NAME', 'NOTE', 'DATE']
    ]
  };
}

module.exports = { basicTables };
