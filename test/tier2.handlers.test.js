const { describe, test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadBackend, resetSheets, doPostJson } = require('./mockSheets.js');
const { basicTables } = require('./fixtures.js');

const SECRET = 'test-secret';

function freshTables() {
  return basicTables();
}

// Helpers to stub SWU site standings pages (same format as tier3).
const BASE = 'https://stockholm.sw-unlimited.com/';
const standingsUrl = (seasonNumber, roundNumber) => `${BASE}season/${seasonNumber}/round/${roundNumber}`;
function standingsHtml(players) {
  const arr = players
    .map((p) => `{id:0,roundId:0,playerUsername:"${p.user}",playerName:"${p.name}",rank:${p.rank},points:0}`)
    .join(',');
  return `<html>foo standings:[${arr}],seasonWinCounts:{} bar</html>`;
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

  test('getAllSeasons returns id/name pairs, newest first', () => {
    const seasons = getAllSeasons();
    assert.equal(seasons.length, 2);
    assert.deepEqual(seasons[0], { id: 'S2', name: 'Season 2' });
    assert.deepEqual(seasons[1], { id: 'S1', name: 'Season 1' });
  });

  test('getAllSeasons sorts numerically, not by sheet row order', () => {
    const tables = basicTables();
    // Deliberately out of chronological sheet order.
    tables.Seasons = [
      ['ID', 'NAME'],
      ['S3', 'Season 3'],
      ['S1', 'Season 1'],
      ['S2', 'Season 2']
    ];
    resetSheets(tables);
    const seasons = getAllSeasons().map((s) => s.id);
    assert.deepEqual(seasons, ['S3', 'S2', 'S1']);
  });

  test('getSeasonName resolves a known season id (and falls back)', () => {
    assert.equal(getSeasonName('S1'), 'Season 1');
    assert.equal(getSeasonName('S999'), 'Season 999');
    assert.equal(getSeasonName(''), 'Unknown Season');
  });

  test('getSeasonPlayers returns all active master players', () => {
    const players = getSeasonPlayers();
    const ids = players.map((p) => p.id).sort();
    assert.deepEqual(ids, ['p1', 'p2', 'p3', 'p4']);
    // p5 is inactive in Players -> excluded.
    assert.ok(!ids.includes('p5'));
    // No per-season narrowing anymore: any season sees the same active roster.
    assert.deepEqual(getSeasonPlayers().map((p) => p.id).sort(), ['p1', 'p2', 'p3', 'p4']);
  });

  test('getUnlinkedPlayers returns only players without a linked email', () => {
    const unlinked = getUnlinkedPlayers().map((p) => p.id).sort();
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

  test('hasSubmittedThisWeek respects season and week (via LeaderVotes)', () => {
    assert.equal(hasSubmittedThisWeek('p1', 'S1', 'Week 2'), true);
    assert.equal(hasSubmittedThisWeek('p1', 'S1', 'Week 3'), false);
    assert.equal(hasSubmittedThisWeek('p1', 'S2', 'Week 2'), false);
  });

  test('hasSubmittedThisWeek detects a player with a leader vote', () => {
    // p2 has a LeaderVote in S1 week 2 and no other week/submission data.
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
    // Add a LeaderVote row for p1 in S2 week 3 to flag them as submitted.
    env.sheets.LeaderVotes.appendRow(['2026-01-01', 'S2', 3, 'p1', 'l1']);
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

  test('records a leader + opponent row (tally only, no voter attribution)', () => {
    const res = handleSubmitVote(
      { leaderId: 'l1', opponentId: 'p3' },
      'alice@x.com'
    );
    assert.equal(res.success, true);
    const lvLast = env.sheets.LeaderVotes.rows[env.sheets.LeaderVotes.rows.length - 1];
    assert.equal(lvLast[1], 'S2');
    assert.equal(lvLast[2], 3);
    assert.equal(lvLast[3], 'p1'); // voter playerId (leaderboard + dedup)
    assert.equal(lvLast[4], 'l1'); // leader
    assert.equal(lvLast.length, 5); // timestamp, seasonId, week, playerId, leaderId

    const ovLast = env.sheets.OpponentVotes.rows[env.sheets.OpponentVotes.rows.length - 1];
    assert.equal(ovLast[3], 'p3'); // opponent
    assert.equal(ovLast.length, 4); // timestamp, seasonId, week, opponentId (no voter)
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
    env.sheets.LeaderVotes.appendRow(['2026-01-01', 'S2', 3, 'p1', 'l1']);
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

  test('builds leader/ambassador/schemer boards for a closed season', () => {
    const res = handleGetLeaderboardData('S1');
    assert.equal(res.success, true);
    assert.equal(res.seasonId, 'S1');
    assert.equal(res.isActiveSeason, false);

    // S1 leader votes: l1 once (p1), l2 twice (p2, p1). So l2 tops with 2 plays.
    const topLeader = res.leaderLeaderboard[0];
    assert.equal(topLeader.name, 'Han Solo - R');
    assert.equal(topLeader.score, '2 Plays');
    assert.equal(topLeader.displayRank, 1);

    // Ambassadors (vote fallback): p2 chosen by p1; p1 chosen by p2 -> tie at
    // 1 each. Real names, because the season is closed.
    assert.equal(res.ambassador.length, 2);
    assert.equal(res.ambassador[0].score, '1 Votes');
    const ambNames = res.ambassador.map((o) => o.name).sort();
    assert.deepEqual(ambNames, ['Alice', 'Bob']);

    // Schemer (vote fallback): p1 played {l1,l2}, p2 {l2} -> p1 tops.
    assert.equal(res.schemer[0].name, 'Alice');
    assert.equal(res.schemer[0].score, '2 Leaders');

    // No Awards rows for S1 and no site URLs -> site sections stay hidden.
    assert.equal(res.ruler, null);
    assert.equal(res.newHope, null);
    // Bounty Hunter is shown (empty until manually filled) once closed.
    assert.deepEqual(res.bountyHunter, []);

    // Loyalty was removed from the response.
    assert.equal(res.loyalty, undefined);
  });

  test('defaults to the active season when none is requested (live obfuscation)', () => {
    // Give the active season S2 some opponent votes to verify obfuscation.
    env.sheets.OpponentVotes.appendRow(['2026-01-01', 'S2', 3, 'p3']);
    env.sheets.OpponentVotes.appendRow(['2026-01-01', 'S2', 3, 'p3']);
    const res = handleGetLeaderboardData(undefined);
    assert.equal(res.seasonId, 'S2');
    assert.equal(res.isActiveSeason, true);
    // Live: favorite opponents are codenames, not real names.
    assert.equal(res.ambassador.length, 1);
    assert.equal(res.ambassador[0].name, 'Gold Leader');
    assert.equal(res.ambassador[0].score, '2 Votes');
    // No site fixtures -> live site sections hidden; Bounty Hunter hidden live.
    assert.equal(res.ruler, null);
    assert.equal(res.newHope, null);
    assert.equal(res.bountyHunter, null);
  });

  test('live Galactic Ruler comes from the current-week standings', () => {
    // S2 is the active season at Week 3 with voting open -> Ruler reads round 3.
    resetSheets(freshTables(), {
      urlFixtures: {
        [standingsUrl(2, 3)]: standingsHtml([
          { user: 'MAlice', name: 'Alice', rank: 1 },
          { user: 'MBob', name: 'Bob', rank: 2 }
        ])
      }
    });
    const res = handleGetLeaderboardData('S2');
    // Top-3 podium from the current-week standings (no ties on the site).
    assert.equal(res.ruler.length, 2);
    assert.equal(res.ruler[0].name, 'Alice');
    assert.equal(res.ruler[0].displayRank, 1);
    assert.equal(res.ruler[0].score, 'Rank #1');
    assert.equal(res.ruler[1].name, 'Bob');
    assert.equal(res.ruler[1].displayRank, 2);
    assert.equal(res.ruler[1].score, 'Rank #2');
    // Week 3 is before the midpoint+1 gate, so A New Hope stays hidden.
    assert.equal(res.newHope, null);
  });

  test('Ruler top-3 shows the podium with site ranks and drops the rest', () => {
    resetSheets(freshTables(), {
      urlFixtures: {
        [standingsUrl(2, 3)]: standingsHtml([
          { user: 'MAlice', name: 'Alice', rank: 1 },
          { user: 'MBob', name: 'Bob', rank: 2 },
          { user: 'MCara', name: 'Cara', rank: 3 },
          { user: 'MDan', name: 'Dan', rank: 4 }
        ])
      }
    });
    const res = handleGetLeaderboardData('S2');
    assert.equal(res.ruler.length, 3);
    assert.deepEqual(res.ruler.map((r) => r.displayRank), [1, 2, 3]);
    assert.deepEqual(res.ruler.map((r) => r.score), ['Rank #1', 'Rank #2', 'Rank #3']);
    assert.deepEqual(res.ruler.map((r) => r.name), ['Alice', 'Bob', 'Cara']);
  });

  test('A New Hope appears only after the midpoint+1 week', () => {
    const fixtures = {
      [standingsUrl(2, 5)]: standingsHtml([
        { user: 'MAlice', name: 'Alice', rank: 6 },
        { user: 'MBob', name: 'Bob', rank: 1 },
        { user: 'MCara', name: 'Cara', rank: 4 }
      ]),
      [standingsUrl(2, 6)]: standingsHtml([
        { user: 'MAlice', name: 'Alice', rank: 1 },
        { user: 'MBob', name: 'Bob', rank: 1 },
        { user: 'MCara', name: 'Cara', rank: 2 }
      ])
    };

    // Week 5 (the midpoint): the mid+1 gate is not reached -> hidden.
    const week5Tables = freshTables();
    week5Tables.Settings[2] = ['CURRENT_WEEK', 'Week 5'];
    resetSheets(week5Tables, { urlFixtures: fixtures });
    assert.equal(handleGetLeaderboardData('S2').newHope, null);

    // Week 6 (midpoint + 1): A New Hope is now tracked. Alice climbed 5
    // places, Cara climbed 2, Bob was flat -> only positive climbers shown,
    // ordered by climb.
    const week6Tables = freshTables();
    week6Tables.Settings[2] = ['CURRENT_WEEK', 'Week 6'];
    resetSheets(week6Tables, { urlFixtures: fixtures });
    const week6 = handleGetLeaderboardData('S2');
    assert.equal(week6.newHope.length, 2);
    assert.equal(week6.newHope[0].name, 'Alice');
    assert.equal(week6.newHope[0].displayRank, 1);
    assert.equal(week6.newHope[0].score, '+5 Climb');
    assert.equal(week6.newHope[1].name, 'Cara');
    assert.equal(week6.newHope[1].displayRank, 2);
    assert.equal(week6.newHope[1].score, '+2 Climb');
  });

  test('A New Hope top-3 uses tie-aware ranks for equal climbs', () => {
    const fixtures = {
      [standingsUrl(2, 5)]: standingsHtml([
        { user: 'MAlice', name: 'Alice', rank: 4 },
        { user: 'MBob', name: 'Bob', rank: 5 },
        { user: 'MCara', name: 'Cara', rank: 3 },
        { user: 'MDan', name: 'Dan', rank: 2 }
      ]),
      [standingsUrl(2, 6)]: standingsHtml([
        { user: 'MAlice', name: 'Alice', rank: 1 }, // climbed 3
        { user: 'MBob', name: 'Bob', rank: 2 },     // climbed 3 (tie at 1st)
        { user: 'MCara', name: 'Cara', rank: 2 },   // climbed 1
        { user: 'MDan', name: 'Dan', rank: 1 }      // climbed 1
      ])
    };
    const tables = freshTables();
    tables.Settings[2] = ['CURRENT_WEEK', 'Week 6'];
    resetSheets(tables, { urlFixtures: fixtures });
    const res = handleGetLeaderboardData('S2');
    assert.equal(res.newHope.length, 3);
    // Alice + Bob tied at 1st; Cara (or Dan) holds 3rd.
    assert.deepEqual(res.newHope.map((r) => r.displayRank), [1, 1, 3]);
    assert.deepEqual(res.newHope.map((r) => r.score), ['+3 Climb', '+3 Climb', '+1 Climb']);
    assert.deepEqual(res.newHope[0].name, 'Alice');
    assert.deepEqual(res.newHope[1].name, 'Bob');
  });

  test('reveals real names the moment voting closes while still the active season', () => {
    const tables = freshTables();
    tables.Settings[2] = ['CURRENT_WEEK', 'Season Ended'];
    tables.Settings[3] = ['VOTING_OPEN', 'FALSE'];
    tables.OpponentVotes.push(['2026-01-01', 'S2', 11, 'p3']);
    tables.OpponentVotes.push(['2026-01-01', 'S2', 11, 'p3']);
    resetSheets(tables);
    const res = handleGetLeaderboardData('S2');
    assert.equal(res.isActiveSeason, true);
    assert.equal(res.ambassador[0].name, 'Cara');
    assert.equal(res.ambassador[0].score, '2 Votes');
    // Closed -> Bounty Hunter section appears (empty until manually filled).
    assert.deepEqual(res.bountyHunter, []);
  });

  test('awards-first: a filled award row overrides the vote-based section', () => {
    const tables = freshTables();
    tables.Awards.push(['S1', 'Galactic Ambassador', 'p3']);
    tables.Awards.push(['S1', 'Galactic Schemer', 'p2']);
    resetSheets(tables);
    const res = handleGetLeaderboardData('S1');
    assert.equal(res.ambassador.length, 1);
    assert.equal(res.ambassador[0].name, 'Cara');
    assert.equal(res.ambassador[0].score, 'Awarded');
    assert.equal(res.ambassador[0].subtitle, 'Awarded');
    assert.equal(res.schemer.length, 1);
    assert.equal(res.schemer[0].name, 'Bob');
    assert.equal(res.schemer[0].score, 'Awarded');
  });

  test('filled site-award rows override the live board even before the gate', () => {
    const tables = freshTables();
    tables.Settings[2] = ['CURRENT_WEEK', 'Week 2'];
    tables.Awards.push(['S2', 'Galactic Ruler', 'p3']);
    tables.Awards.push(['S2', 'A New Hope', 'p1']);
    resetSheets(tables);
    const res = handleGetLeaderboardData('S2');
    assert.equal(res.isActiveSeason, true);
    assert.equal(res.ruler[0].name, 'Cara');
    assert.equal(res.newHope[0].name, 'Alice');
  });

  test('historical failover uses the final round, not the active season week', () => {
    // Active season is S2 at week 3; viewing S1 must read round 11 (final).
    // Round 3 rank 1 is Bob (would win if we wrongly read the settings week).
    const fixtures = {
      [standingsUrl(1, 3)]: standingsHtml([
        { user: 'MBob', name: 'Bob', rank: 1 }
      ]),
      [standingsUrl(1, 5)]: standingsHtml([
        { user: 'MAlice', name: 'Alice', rank: 3 },
        { user: 'MBob', name: 'Bob', rank: 1 }
      ]),
      [standingsUrl(1, 11)]: standingsHtml([
        { user: 'MAlice', name: 'Alice', rank: 1 },
        { user: 'MBob', name: 'Bob', rank: 2 }
      ])
    };
    resetSheets(freshTables(), { urlFixtures: fixtures });
    const res = handleGetLeaderboardData('S1');

    // Ruler = final round podium (Alice #1, Bob #2), NOT round 3's rank 1 (Bob).
    assert.equal(res.ruler.length, 2);
    assert.equal(res.ruler[0].name, 'Alice');
    assert.equal(res.ruler[0].score, 'Rank #1');
    assert.equal(res.ruler[1].name, 'Bob');
    assert.equal(res.ruler[1].score, 'Rank #2');
    // A New Hope compares midpoint round 5 vs final round 11.
    assert.equal(res.newHope.length, 1);
    assert.equal(res.newHope[0].name, 'Alice');
    assert.equal(res.newHope[0].score, '+2 Climb');
  });

  test('site outage leaves the site-based sections hidden but keeps the board up', () => {
    // No URL fixtures -> fetch throws -> the leaderboard still succeeds.
    const res = handleGetLeaderboardData('S1');
    assert.equal(res.success, true);
    assert.equal(res.ruler, null);
    assert.equal(res.newHope, null);
    assert.ok(res.schemer.length > 0);
  });

  test('Bounty Hunter is hidden live and appears only after the season ends', () => {
    // Live: hidden.
    assert.equal(handleGetLeaderboardData('S2').bountyHunter, null);

    // After close, with a manually-filled row: shown as an award.
    const tables = freshTables();
    tables.Settings[2] = ['CURRENT_WEEK', 'Season Ended'];
    tables.Settings[3] = ['VOTING_OPEN', 'FALSE'];
    tables.Awards.push(['S2', 'Bounty Hunter', 'p1']);
    resetSheets(tables);
    const res = handleGetLeaderboardData('S2');
    assert.equal(res.bountyHunter.length, 1);
    assert.equal(res.bountyHunter[0].name, 'Alice');
    assert.equal(res.bountyHunter[0].score, 'Awarded');
  });
});

describe('handleGetMySeasonStats', () => {
  let env;
  beforeEach(() => {
    env = resetSheets(freshTables());
  });

  test('resolves the linked player and returns leaders played for a season', () => {
    // p1 (Alice) links alice@x.com. S1 leader votes: p1 played l1 once, l2 once.
    const res = handleGetMySeasonStats('S1', 'alice@x.com');
    assert.equal(res.success, true);
    assert.equal(res.seasonId, 'S1');
    assert.equal(res.isActiveSeason, false);
    // Two leaders, one play each.
    assert.equal(res.leaders.length, 2);
    const byId = {};
    res.leaders.forEach((l) => { byId[l.id] = l.plays; });
    assert.equal(byId['l1'], 1);
    assert.equal(byId['l2'], 1);
    // Names resolved from Leaders as `name - set`.
    const names = res.leaders.map((l) => l.name).sort();
    assert.deepEqual(names, ['Han Solo - R', 'Leia Organa - L']);
  });

  test('returns awards won from the Awards record', () => {
    env.sheets.Awards.appendRow(['S1', 'Galactic Ambassador', 'p1']);
    env.sheets.Awards.appendRow(['S1', 'Galactic Schemer', 'p1']);
    const res = handleGetMySeasonStats('S1', 'alice@x.com');
    assert.deepEqual(res.awardsWon.sort(), ['Galactic Ambassador', 'Galactic Schemer']);
  });

  test('filters awards to the selected season and player', () => {
    env.sheets.Awards.appendRow(['S1', 'Galactic Schemer', 'p1']);
    env.sheets.Awards.appendRow(['S1', 'Galactic Schemer', 'p2']); // different player
    env.sheets.Awards.appendRow(['S2', 'Galactic Ambassador', 'p1']); // different season
    const res = handleGetMySeasonStats('S1', 'alice@x.com');
    assert.deepEqual(res.awardsWon, ['Galactic Schemer']);
  });

  test('Bounty Hunter appears once its placeholder playerId is filled in manually', () => {
    // The placeholder is written with an empty playerId at close (never matches);
    // once the user fills it in, the linked player sees it as an award won.
    env.sheets.Awards.appendRow(['S1', 'Bounty Hunter', '']);
    const before = handleGetMySeasonStats('S1', 'alice@x.com');
    assert.deepEqual(before.awardsWon, []);

    const rows = env.sheets.Awards.rows;
    rows[rows.length - 1][2] = 'p1';
    const after = handleGetMySeasonStats('S1', 'alice@x.com');
    assert.deepEqual(after.awardsWon, ['Bounty Hunter']);
  });

  test('defaults to the active season (no awards yet for the current season)', () => {
    const res = handleGetMySeasonStats(undefined, 'alice@x.com');
    assert.equal(res.seasonId, 'S2');
    assert.equal(res.isActiveSeason, true);
    // No awards written for the current season yet.
    assert.deepEqual(res.awardsWon, []);
    // No leader plays for p1 in S2 -> empty board.
    assert.deepEqual(res.leaders, []);
  });

  test('throws when the user is not linked', () => {
    assert.throws(() => handleGetMySeasonStats('S1', 'unknown@x.com'), /Link your account first/);
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
    env.sheets.LeaderVotes.appendRow(['2026-01-01', 'S2', 3, 'p1', 'l1']);
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
