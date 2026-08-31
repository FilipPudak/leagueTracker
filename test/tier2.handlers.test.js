const { describe, test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadBackend, resetSheets, doPostJson } = require('./mockSheets.js');
const { basicTables } = require('./fixtures.js');

const SECRET = 'test-secret';

function freshTables() {
  return basicTables();
}

// Load the backend once into the host realm; swap sheets per test below.
loadBackend();

describe('data retrieval helpers', () => {
  let env;
  beforeEach(() => {
    env = resetSheets(freshTables());
  });

  test('getSettings reads key/value pairs, skipping the header', () => {
    const s = getSettings();
    assert.equal(s.ACTIVE_SEASON_ID, 'S2');
    assert.equal(s.CURRENT_WEEK, 'Week 3');
    assert.equal(s.VOTING_OPEN, 'TRUE');
  });

  test('getAllSeasons returns id/name pairs for every season', () => {
    const seasons = getAllSeasons();
    assert.equal(seasons.length, 2);
    assert.deepEqual(seasons[0], { id: 'S1', name: 'Season 1' });
    assert.deepEqual(seasons[1], { id: 'S2', name: 'Season 2' });
  });

  test('getSeasonName resolves a known season id (and falls back)', () => {
    assert.equal(getSeasonName('S1'), 'Season 1');
    assert.equal(getSeasonName('S999'), 'Season 999');
    assert.equal(getSeasonName(''), 'Unknown Season');
  });

  test('getSeasonPlayers returns only players active in the given season', () => {
    const players = getSeasonPlayers('S2');
    const ids = players.map((p) => p.id).sort();
    assert.deepEqual(ids, ['p1', 'p2', 'p3', 'p4']);
    // p5 is inactive in Players -> excluded even if listed.
    assert.ok(!ids.includes('p5'));
    // S1 only has p1 and p2.
    const s1 = getSeasonPlayers('S1').map((p) => p.id).sort();
    assert.deepEqual(s1, ['p1', 'p2']);
  });

  test('getUnlinkedPlayers returns only players without a linked email', () => {
    const unlinked = getUnlinkedPlayers('S2').map((p) => p.id).sort();
    assert.deepEqual(unlinked, ['p3', 'p4']);
  });

  test('findPlayerByGoogleEmail matches case-insensitively and flags active', () => {
    const p = findPlayerByGoogleEmail('  ALICE@X.COM ');
    assert.equal(p.id, 'p1');
    assert.equal(p.name, 'Alice');
    assert.equal(p.active, true);
    const inactive = findPlayerByGoogleEmail('old@x.com');
    assert.equal(inactive.id, 'p5');
    assert.equal(inactive.active, false);
    assert.equal(findPlayerByGoogleEmail('missing@x.com'), null);
    assert.equal(findPlayerByGoogleEmail(''), null);
  });

  test('hasSubmittedThisWeek respects season and week (via SubmissionLog)', () => {
    // alert() is not used; SubmissionLog has p1 submitted S1 week 2.
    assert.equal(hasSubmittedThisWeek('p1', 'S1', 'Week 2'), true);
    assert.equal(hasSubmittedThisWeek('p1', 'S1', 'Week 3'), false);
    assert.equal(hasSubmittedThisWeek('p1', 'S2', 'Week 2'), false);
  });

  test('hasSubmittedThisWeek falls back to LeaderVotes when SubmissionLog is empty', () => {
    // p1 has a LeaderVote in S1 week 2 but SubmissionLog row is for p1 too,
    // so force the fallback by looking at a player with no SubmissionLog row but a vote.
    // p2 has a LeaderVote in S1 week 2 and no SubmissionLog row -> fallback path.
    assert.equal(hasSubmittedThisWeek('p2', 'S1', 'Week 2'), true);
    assert.equal(hasSubmittedThisWeek('p2', 'S2', 'Week 2'), false);
  });
});

describe('handleGetAppData', () => {
  let env;
  beforeEach(() => {
    env = resetSheets(freshTables());
  });

  test('linked user gets roster, leaders and alreadySubmitted flag', () => {
    const data = handleGetAppData('alice@x.com');
    assert.equal(data.linked, true);
    assert.equal(data.linkedPlayer.name, 'Alice');
    assert.equal(data.seasonId, 'S2');
    assert.equal(data.week, 3);
    assert.equal(data.votingOpen, true);
    assert.equal(data.seasons.length, 2);
    assert.equal(data.players.length, 4);
    assert.equal(data.leaders.length, 3);
    assert.equal(data.alreadySubmitted, false); // S2 week 3 not submitted yet
    assert.equal(data.unlinkedPlayers.length, 0);
  });

  test('unlinked user gets unlinkedPlayers and no roster', () => {
    const data = handleGetAppData('newbie@x.com');
    assert.equal(data.linked, false);
    assert.equal(data.players.length, 0);
    assert.equal(data.unlinkedPlayers.map((p) => p.id).sort().join(','), 'p3,p4');
  });

  test('a player who already submitted this week is flagged', () => {
    // Temporarily add a submission log for p1 in S2 week 3.
    env.sheets.SubmissionLog.appendRow(['9', 'S2', 3, 'p1']);
    const data = handleGetAppData('alice@x.com');
    assert.equal(data.alreadySubmitted, true);
    assert.equal(data.hasVoted, true);
  });
});

describe('handleLinkGoogleAccount', () => {
  let env;
  beforeEach(() => {
    env = resetSheets(freshTables());
  });

  test('links an unlinked player to an email', () => {
    const res = handleLinkGoogleAccount('p3', 'cara@x.com');
    assert.equal(res.success, true);
    // The Players sheet email column (col 4) should be updated for p3.
    const playerSheet = env.sheets.Players;
    const row = playerSheet.rows.find((r) => r[0] === 'p3');
    assert.equal(String(row[3]).toLowerCase(), 'cara@x.com');
    // Returns linked roster/leaders for the active season.
    assert.equal(res.players.length, 4);
    assert.equal(res.leaders.length, 3);
  });

  test('rejects relinking an email that is already taken by another player', () => {
    let msg;
    try {
      handleLinkGoogleAccount('p3', 'alice@x.com');
    } catch (err) {
      msg = err.userMessage;
    }
    assert.match(msg, /already linked to/);
  });

  test('rejects linking a player that is already linked', () => {
    let msg;
    try {
      handleLinkGoogleAccount('p1', 'someone@x.com');
    } catch (err) {
      msg = err.userMessage;
    }
    assert.match(msg, /already linked to another/);
  });

  test('is a no-op (returns existing) when the same player re-links the same email', () => {
    const res = handleLinkGoogleAccount('p1', 'alice@x.com');
    assert.equal(res.player.id, 'p1');
  });

  test('throws when playerId or email is missing', () => {
    assert.throws(() => handleLinkGoogleAccount('', 'x@x.com'), /Missing Player Selection/);
    assert.throws(() => handleLinkGoogleAccount('p3', ''), /Missing Player Selection/);
  });
});

describe('handleSubmitVote', () => {
  let env;
  beforeEach(() => {
    env = resetSheets(freshTables());
  });

  test('records a leader + opponent + submission log row', () => {
    const res = handleSubmitVote(
      { leaderId: 'l1', opponentId: 'p3' },
      'alice@x.com'
    );
    assert.equal(res.success, true);
    const lvLast = env.sheets.LeaderVotes.rows[env.sheets.LeaderVotes.rows.length - 1];
    assert.equal(lvLast[1], 'S2');
    assert.equal(lvLast[2], 3);
    assert.equal(lvLast[3], 'p1');
    assert.equal(lvLast[4], 'l1');

    const ovLast = env.sheets.OpponentVotes.rows[env.sheets.OpponentVotes.rows.length - 1];
    assert.equal(ovLast[3], 'p3'); // opponent
    assert.equal(ovLast[4], 'p1'); // voter

    const slLast = env.sheets.SubmissionLog.rows[env.sheets.SubmissionLog.rows.length - 1];
    assert.equal(slLast[3], 'p1');
  });

  test('accepts alternate vote field names (voteData / favoriteOpponentId)', () => {
    const res = handleSubmitVote(
      { voteData: { leader1Id: 'l2', favoriteOpponentId: 'p2' } },
      'alice@x.com'
    );
    assert.equal(res.success, true);
  });

  test('rejects voting when voting is closed', () => {
    const closed = freshTables();
    closed.Settings[3] = ['VOTING_OPEN', 'FALSE'];
    resetSheets(closed);
    let msg;
    try {
      handleSubmitVote({ leaderId: 'l1' }, 'alice@x.com');
    } catch (err) {
      msg = err.userMessage;
    }
    assert.match(msg, /voting is currently closed/i);
  });

  test('rejects voting by an unlinked / unknown player', () => {
    let msg;
    try {
      handleSubmitVote({ leaderId: 'l1' }, 'nobody@x.com');
    } catch (err) {
      msg = err.userMessage;
    }
    assert.match(msg, /unlinked or inactive/i);
  });

  test('rejects a duplicate submission for the same week', () => {
    env.sheets.SubmissionLog.appendRow(['9', 'S2', 3, 'p1']);
    let msg;
    try {
      handleSubmitVote({ leaderId: 'l1' }, 'alice@x.com');
    } catch (err) {
      msg = err.userMessage;
    }
    assert.match(msg, /already submitted/i);
  });

  test('rejects selecting yourself as favorite opponent', () => {
    let msg;
    try {
      handleSubmitVote({ leaderId: 'l1', opponentId: 'p1' }, 'alice@x.com');
    } catch (err) {
      msg = err.userMessage;
    }
    assert.match(msg, /can't select yourself/i);
  });
});

describe('handleGetLeaderboardData', () => {
  let env;
  beforeEach(() => {
    env = resetSheets(freshTables());
  });

  test('builds leader/opponent/diversity/loyalty boards for a season', () => {
    const res = handleGetLeaderboardData('S1');
    assert.equal(res.success, true);
    assert.equal(res.seasonId, 'S1');
    assert.equal(res.isActiveSeason, false);

    // S1 leader votes: l1 once (p1), l2 twice (p2, p1). So l2 tops with 2 votes.
    const topLeader = res.leaderLeaderboard[0];
    assert.equal(topLeader.name, 'Han - Solo');
    assert.equal(topLeader.votes, 2);
    assert.equal(topLeader.displayRank, 1);

    // Opponents: p2 chosen by p1; p1 chosen by p2 -> tie at 1 each.
    assert.equal(res.opponentLeaderboard.length, 2);
    assert.equal(res.opponentLeaderboard[0].votes, 1);
    assert.equal(res.opponentLeaderboard[1].votes, 1);

    // Diversity: p1 played {l1,l2}, p2 {l2} -> p1 has 2 different leaders.
    const div = res.diversity.filter((d) => d.playerName === 'Alice')[0];
    assert.equal(div.differentLeaders, 2);

    // Loyalty: p2 played l2 once, p1's top is l2 once too -> tie at 1 night.
    const loyal = res.loyalty.filter((l) => l.playerName === 'Alice')[0];
    assert.equal(loyal.nights, 1);
  });

  test('defaults to the active season when none is requested', () => {
    const res = handleGetLeaderboardData(undefined);
    assert.equal(res.seasonId, 'S2');
    assert.equal(res.isActiveSeason, true);
  });
});

describe('doPost dispatch & security', () => {
  let env;
  beforeEach(() => {
    env = resetSheets(freshTables());
  });

  test('routes to the correct handlers', () => {
    const ok = doPostJson({ action: 'getAppData', userEmail: 'alice@x.com', apiSecret: SECRET });
    assert.equal(ok.success, true);
    assert.equal(ok.data.linked, true);
  });

  test('rejects requests with a bad secret before dispatching', () => {
    const bad = doPostJson({ action: 'getAppData', userEmail: 'alice@x.com', apiSecret: 'wrong' });
    assert.equal(bad.success, false);
    assert.equal(bad.error, 'Unauthorized.');
  });

  test('rejects an invalid action with the generic fallback message', () => {
    const bad = doPostJson({ action: 'nope', userEmail: 'alice@x.com', apiSecret: SECRET });
    assert.equal(bad.success, false);
    assert.equal(bad.error, 'Something went wrong. Please try again.');
  });

  test('rejects a missing user identity', () => {
    const bad = doPostJson({ action: 'getAppData', userEmail: '', apiSecret: SECRET });
    assert.equal(bad.success, false);
  });

  test('maps business errors to per-action friendly messages', () => {
    // Force a userError in submitVote (duplicate) and check the friendly message.
    env.sheets.SubmissionLog.appendRow(['9', 'S2', 3, 'p1']);
    const res = doPostJson({
      action: 'submitVote',
      userEmail: 'alice@x.com',
      apiSecret: SECRET,
      leaderId: 'l1'
    });
    assert.equal(res.success, false);
    assert.equal(res.error, 'You have already submitted votes for this week.');
  });

  test('returns a busy error when the script lock cannot be acquired', () => {
    env.state.scriptLockGranted = false;
    const res = doPostJson({ action: 'getAppData', userEmail: 'alice@x.com', apiSecret: SECRET });
    assert.equal(res.success, false);
    assert.equal(res.error, 'Database is busy. Please try again.');
  });
});
