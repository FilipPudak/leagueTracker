const { describe, test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadBackend, resetSheets } = require('./mockSheets.js');
const { basicTables } = require('./fixtures.js');

loadBackend();

const BASE = 'https://stockholm.sw-unlimited.com/';
const standingsUrl = (seasonNumber, roundNumber) => `${BASE}season/${seasonNumber}/round/${roundNumber}`;

// Builds a minimal HTML page whose embedded SvelteKit payload contains a
// "standings" array using the site's unquoted-key JS object-literal format.
function standingsHtml(players) {
  const arr = players
    .map((p) => `{id:0,roundId:0,playerUsername:"${p.user}",playerName:"${p.name}",rank:${p.rank},points:${p.points ?? 0}}`)
    .join(',');
  return `<html>foo standings:[${arr}],seasonWinCounts:{} bar</html>`;
}

describe('refreshAwardsPodium', () => {
  // Returns a fixture with the active season S2 at Week 6 (past the midpoint),
  // with votes for S2 so Schemer/Ambassador resolve, plus site round fixtures.
  function seasonFixture() {
    const tables = basicTables();
    tables.Settings = [
      ['KEY', 'VALUE'],
      ['ACTIVE_SEASON_ID', 'S2'],
      ['CURRENT_WEEK', 'Week 6'],
      ['VOTING_OPEN', 'TRUE'],
      ['SEASON_LENGTH', '11']
    ];
    // S2 votes: p3 gets 2 opponent votes (Ambassador); p1 plays {l1,l2}
    // (Schemer), p2 plays {l2}.
    tables.OpponentVotes = [
      ['TS', 'SEASON_ID', 'WEEK', 'OPPONENT_ID'],
      ['2026-01-01', 'S2', 5, 'p3'],
      ['2026-01-01', 'S2', 5, 'p3'],
      ['2026-01-01', 'S2', 5, 'p1']
    ];
    tables.LeaderVotes = [
      ['TS', 'SEASON_ID', 'WEEK', 'PLAYER_ID', 'LEADER_ID'],
      ['2026-01-01', 'S2', 5, 'p1', 'l1'],
      ['2026-01-01', 'S2', 5, 'p1', 'l2'],
      ['2026-01-01', 'S2', 5, 'p2', 'l2']
    ];
    return tables;
  }

  test('first run creates 15 rows and fills the four computed awards', () => {
    const tables = seasonFixture();
    const fixtures = {
      // Ruler: Alice rank1 67 pts, Bob rank2 60 pts.
      [standingsUrl(2, 6)]: standingsHtml([
        { user: 'MAlice', name: 'Alice', rank: 1, points: 67 },
        { user: 'MBob', name: 'Bob', rank: 2, points: 60 }
      ]),
      // New Hope: Alice climbed 6 -> 1 (5), Bob 4 -> 2 (2).
      [standingsUrl(2, 5)]: standingsHtml([
        { user: 'MAlice', name: 'Alice', rank: 6, points: 0 },
        { user: 'MBob', name: 'Bob', rank: 4, points: 0 }
      ])
    };
    const env = resetSheets(tables, { urlFixtures: fixtures });

    const res = refreshAwardsPodium('S2');
    assert.equal(res.success, true);
    assert.equal(res.seasonId, 'S2');

    const rows = env.sheets.Awards.rows.slice(1);
    assert.equal(rows.length, 15, 'expected 15 rows (5 awards x 3)');

    // Each award has exactly 3 rows with the [season, award, id, score] shape.
    const byAward = {};
    rows.forEach(r => { (byAward[r[1]] = byAward[r[1]] || []).push(r); });
    ['Galactic Ruler', 'A New Hope', 'Galactic Schemer', 'Galactic Ambassador', 'Bounty Hunter']
      .forEach(a => assert.equal(byAward[a].length, 3, `expected 3 rows for ${a}`));

    // Galactic Ruler: rank1 first -> Alice 67, Bob 60.
    assert.deepEqual(byAward['Galactic Ruler'], [
      ['S2', 'Galactic Ruler', 'p1', 67],
      ['S2', 'Galactic Ruler', 'p2', 60],
      ['S2', 'Galactic Ruler', '', '']
    ]);
    // A New Hope: top-3 climbers — Alice +5, Bob +2 (positive climbs only).
    assert.deepEqual(byAward['A New Hope'], [
      ['S2', 'A New Hope', 'p1', 5],
      ['S2', 'A New Hope', 'p2', 2],
      ['S2', 'A New Hope', '', '']
    ]);
    // Galactic Schemer: p1 has 2 distinct leaders.
    assert.deepEqual(byAward['Galactic Schemer'], [
      ['S2', 'Galactic Schemer', 'p1', 2],
      ['S2', 'Galactic Schemer', '', ''],
      ['S2', 'Galactic Schemer', '', '']
    ]);
    // Galactic Ambassador: p3 has 2 votes.
    assert.deepEqual(byAward['Galactic Ambassador'], [
      ['S2', 'Galactic Ambassador', 'p3', 2],
      ['S2', 'Galactic Ambassador', '', ''],
      ['S2', 'Galactic Ambassador', '', '']
    ]);
    // Bounty Hunter: blank skeleton.
    assert.deepEqual(byAward['Bounty Hunter'], [
      ['S2', 'Bounty Hunter', '', ''],
      ['S2', 'Bounty Hunter', '', ''],
      ['S2', 'Bounty Hunter', '', '']
    ]);
  });

  test('re-running overwrites in place without duplicating rows', () => {
    const tables = seasonFixture();
    const fixtures = {
      [standingsUrl(2, 6)]: standingsHtml([
        { user: 'MAlice', name: 'Alice', rank: 1, points: 67 },
        { user: 'MBob', name: 'Bob', rank: 2, points: 60 }
      ]),
      [standingsUrl(2, 5)]: standingsHtml([
        { user: 'MAlice', name: 'Alice', rank: 6, points: 0 },
        { user: 'MBob', name: 'Bob', rank: 4, points: 0 }
      ])
    };
    const env = resetSheets(tables, { urlFixtures: fixtures });

    refreshAwardsPodium('S2');
    const afterFirst = env.sheets.Awards.rows.map(r => r.slice());
    refreshAwardsPodium('S2');
    const afterSecond = env.sheets.Awards.rows.map(r => r.slice());

    assert.equal(env.sheets.Awards.rows.slice(1).length, 15);
    assert.deepEqual(afterSecond, afterFirst);
  });

  test('does nothing for a historical (non-active) season', () => {
    const env = resetSheets(basicTables()); // active = S2
    const res = refreshAwardsPodium('S1');
    assert.equal(res.success, false);
    assert.equal(res.reason, 'not-active');
    assert.equal(env.sheets.Awards.rows.length, 1); // header untouched
  });

  test('site outage still fills vote-based awards, site awards stay skeleton', () => {
    // No round fixtures -> Ruler/NewHope resolve to nothing, but the vote
    // awards (Schemer/Ambassador) still fill from the sheet.
    const tables = seasonFixture();
    const env = resetSheets(tables);

    refreshAwardsPodium('S2');
    const byAward = {};
    env.sheets.Awards.rows.slice(1).forEach(r => { (byAward[r[1]] = byAward[r[1]] || []).push(r); });

    assert.equal(byAward['Galactic Ruler'].length, 3);
    // Ruler block exists but all blank (site down).
    assert.deepEqual(byAward['Galactic Ruler'].map(r => r[2]), ['', '', '']);
    assert.equal(byAward['A New Hope'].length, 3);
    assert.deepEqual(byAward['A New Hope'].map(r => r[2]), ['', '', '']);
    // Vote awards still filled.
    assert.deepEqual(byAward['Galactic Schemer'][0].slice(0, 4), ['S2', 'Galactic Schemer', 'p1', 2]);
    assert.deepEqual(byAward['Galactic Ambassador'][0].slice(0, 4), ['S2', 'Galactic Ambassador', 'p3', 2]);
  });

  test('Bounty Hunter is created blank and never overwritten once filled', () => {
    const tables = seasonFixture();
    const fixtures = {
      [standingsUrl(2, 6)]: standingsHtml([{ user: 'MAlice', name: 'Alice', rank: 1, points: 67 }]),
      [standingsUrl(2, 5)]: standingsHtml([{ user: 'MAlice', name: 'Alice', rank: 6, points: 0 }])
    };
    const env = resetSheets(tables, { urlFixtures: fixtures });

    refreshAwardsPodium('S2');
    // Manually fill the Bounty Hunter champion.
    const bountyRows = env.sheets.Awards.rows.slice(1).filter(r => r[1] === 'Bounty Hunter');
    const rowIndex = env.sheets.Awards.rows.indexOf(bountyRows[0]);
    env.sheets.Awards.rows[rowIndex][2] = 'p1';
    env.sheets.Awards.rows[rowIndex][3] = 1;

    // Re-run the refresh; Bounty Hunter must be untouched.
    refreshAwardsPodium('S2');
    const after = env.sheets.Awards.rows.slice(1).filter(r => r[1] === 'Bounty Hunter');
    assert.deepEqual(after[0].slice(0, 4), ['S2', 'Bounty Hunter', 'p1', 1]);
  });

  test('an existing block with more than 3 rows normalizes to exactly 3', () => {
    const tables = seasonFixture();
    const fixtures = {
      [standingsUrl(2, 6)]: standingsHtml([{ user: 'MAlice', name: 'Alice', rank: 1, points: 67 }]),
      [standingsUrl(2, 5)]: standingsHtml([{ user: 'MAlice', name: 'Alice', rank: 6, points: 0 }])
    };
    // Pre-seed a legacy 4-row Galactic Ruler block for S2.
    tables.Awards = [
      ['SEASON_ID', 'AWARD', 'PLAYER_ID', 'SCORE'],
      ['S2', 'Galactic Ruler', 'p1', 67],
      ['S2', 'Galactic Ruler', 'p2', 67],
      ['S2', 'Galactic Ruler', 'p3', 67],
      ['S2', 'Galactic Ruler', 'p4', 67]
    ];
    const env = resetSheets(tables, { urlFixtures: fixtures });

    refreshAwardsPodium('S2');
    const ruler = env.sheets.Awards.rows.slice(1).filter(r => r[1] === 'Galactic Ruler');
    // The legacy 4th row is not deleted but is blanked; the first-3 slots hold
    // the freshly materialized data.
    assert.equal(ruler.length, 4);
    assert.equal(ruler[3][2], '', 'excess legacy row is blanked');
    assert.equal(ruler[0][2], 'p1', 'first slot carries the Ruler winner');
  });
});

describe('getSeasonLength', () => {
  test('returns the configured SEASON_LENGTH', () => {
    const tables = basicTables();
    tables.Settings.push(['SEASON_LENGTH', '8']);
    resetSheets(tables);
    assert.equal(getSeasonLength(), 8);
  });

  test('throws when SEASON_LENGTH is missing', () => {
    const tables = basicTables();
    tables.Settings = [
      ['KEY', 'VALUE'],
      ['ACTIVE_SEASON_ID', 'S2'],
      ['CURRENT_WEEK', 'Week 3'],
      ['VOTING_OPEN', 'TRUE']
    ];
    resetSheets(tables);
    assert.throws(() => getSeasonLength(), /SEASON_LENGTH is not set/);
  });
});

describe('advanceLeagueWeek', () => {
  test('advances to the next week and keeps voting open mid-season', () => {
    const env = resetSheets(basicTables()); // S2, week 3, voting open
    const res = advanceLeagueWeek();
    assert.equal(res.success, true);
    assert.equal(res.newWeek, 'Week 4');
    const settings = getSettings();
    assert.equal(settings.CURRENT_WEEK, 'Week 4');
    assert.equal(settings.VOTING_OPEN, 'TRUE');
  });

  test('does nothing when voting is closed', () => {
    const tables = basicTables();
    tables.Settings = [
      ['KEY', 'VALUE'],
      ['ACTIVE_SEASON_ID', 'S2'],
      ['CURRENT_WEEK', 'Week 3'],
      ['VOTING_OPEN', 'FALSE']
    ];
    const env = resetSheets(tables);
    const res = advanceLeagueWeek();
    assert.equal(res.message, 'Voting closed.');
    // unchanged
    const settings = getSettings();
    assert.equal(settings.CURRENT_WEEK, 'Week 3');
  });

  test('closes the season at week 11 and materializes the award podium', () => {
    const tables = basicTables();
    tables.Settings = [
      ['KEY', 'VALUE'],
      ['ACTIVE_SEASON_ID', 'S2'],
      ['CURRENT_WEEK', 'Week 11'],
      ['VOTING_OPEN', 'TRUE'],
      ['SEASON_LENGTH', '11']
    ];
    // Give S2 an opponent winner so a Galactic Ambassador is produced.
    tables.OpponentVotes = [
      ['TS', 'SEASON_ID', 'WEEK', 'OPPONENT_ID'],
      ['2026-01-01', 'S2', 10, 'p3'],
      ['2026-01-01', 'S2', 10, 'p3']
    ];
    const env = resetSheets(tables);

    const res = advanceLeagueWeek();
    assert.equal(res.success, true);
    assert.equal(res.message, 'Season 11 completed, voting closed, awards calculated.');
    const settings = getSettings();
    assert.equal(settings.VOTING_OPEN, 'FALSE');
    assert.equal(settings.CURRENT_WEEK, 'Season Ended');

    // All 15 podium rows are materialized at close (5 awards x 3).
    const rows = env.sheets.Awards.rows.slice(1);
    assert.equal(rows.length, 15);
    const byAward = {};
    rows.forEach(r => { (byAward[r[1]] = byAward[r[1]] || []).push(r); });
    ['Galactic Ruler', 'A New Hope', 'Galactic Schemer', 'Galactic Ambassador', 'Bounty Hunter']
      .forEach(a => assert.equal(byAward[a].length, 3, `expected 3 rows for ${a}`));

    // Ambassador: p3 with 2 votes. No site fixtures -> Ruler/NewHope skeletons.
    assert.deepEqual(byAward['Galactic Ambassador'][0].slice(0, 4), ['S2', 'Galactic Ambassador', 'p3', 2]);
    assert.deepEqual(byAward['Galactic Ruler'].map(r => r[2]), ['', '', '']);
    assert.deepEqual(byAward['A New Hope'].map(r => r[2]), ['', '', '']);
    assert.deepEqual(byAward['Bounty Hunter'].map(r => r[2]), ['', '', '']);
  });

  test('closes the season at a custom SEASON_LENGTH instead of 11', () => {
    const tables = basicTables();
    tables.Settings = [
      ['KEY', 'VALUE'],
      ['ACTIVE_SEASON_ID', 'S2'],
      ['CURRENT_WEEK', 'Week 8'],
      ['VOTING_OPEN', 'TRUE'],
      ['SEASON_LENGTH', '8']
    ];
    const env = resetSheets(tables);

    const res = advanceLeagueWeek();
    assert.equal(res.success, true);
    assert.equal(res.message, 'Season 8 completed, voting closed, awards calculated.');
    const settings = getSettings();
    assert.equal(settings.VOTING_OPEN, 'FALSE');
    assert.equal(settings.CURRENT_WEEK, 'Season Ended');
    // The full 15-row podium is materialized, including the Bounty Hunter
    // skeleton.
    assert.equal(env.sheets.Awards.rows.slice(1).length, 15);
    const bounty = env.sheets.Awards.rows.slice(1).filter(r => r[1] === 'Bounty Hunter');
    assert.equal(bounty.length, 3);
    assert.ok(bounty.every(r => r[2] === ''), 'expected blank Bounty Hunter skeleton');
  });
});

describe('startNewSeason', () => {
  test('creates the next season, updates settings, resets to week 1 open voting', () => {
    const env = resetSheets(basicTables()); // seasons S1, S2
    const res = startNewSeason();
    assert.equal(res.success, true);
    assert.equal(res.seasonId, 3);
    assert.equal(res.seasonName, 'Season 3');

    // A new season row was appended.
    const seasons = env.sheets.Seasons.rows;
    const last = seasons[seasons.length - 1];
    assert.equal(last[0], 3);
    assert.equal(last[1], 'Season 3');

    const settings = getSettings();
    assert.equal(settings.ACTIVE_SEASON_ID, 3);
    assert.equal(settings.CURRENT_WEEK, 'Week 1');
    assert.equal(settings.VOTING_OPEN, 'TRUE');

    assert.equal(env.state.scriptLockWaited, true, 'startNewSeason should hold the script lock');
  });

  test('formats the appended DATE cell as YYYY-MM-DD', () => {
    const tables = basicTables();
    tables.Seasons = [
      ['ID', 'NAME', 'DATE'],
      ['S1', 'Season 1', '2026-01-01']
    ];
    const env = resetSheets(tables);
    startNewSeason();
    const seasons = env.sheets.Seasons.rows;
    const last = seasons[seasons.length - 1];
    assert.match(String(last[2]), /^\d{4}-\d{2}-\d{2}$/);
  });

  test('derives the next id from mixed season id formats', () => {
    const tables = basicTables();
    tables.Seasons = [
      ['ID', 'NAME', 'DATE'],
      ['S1', 'Season 1', '2026-01-01'],
      ['S2', 'Season 2', '2026-01-08'],
      ['F3', 'Season 3', '2026-01-15']
    ];
    resetSheets(tables);
    const res = startNewSeason();
    assert.equal(res.seasonId, 4);
    assert.equal(res.seasonName, 'Season 4');
  });
});

describe('syncPlayersFromWebsite', () => {
  test('adds new players and updates existing player names', () => {
    const env = resetSheets(basicTables(), {
      props: { SCRAPE_URL: 'https://example.test/' },
      urlFixtures: {
        'https://example.test/': '<a href="/player/MAlice">Alice Updated</a>' +
          '<a href="/player/MNew">New Player</a>'
      }
    });

    syncPlayersFromWebsite();

    const players = env.sheets.Players.rows;
    assert.equal(env.state.scriptLockWaited, true, 'syncPlayersFromWebsite should hold the script lock');
    // Existing player p1 (melee MAlice) name updated.
    const alice = players.find((r) => r[0] === 'p1');
    assert.equal(alice[1], 'Alice Updated');
    // A brand-new player was appended with a generated id.
    const added = players.find((r) => r[1] === 'New Player');
    assert.ok(added, 'expected a new player row');
    assert.equal(added[2], 'MNew');
    assert.equal(added[4], 'TRUE');
  });

  test('skips silently when the site is unreachable', () => {
    const env = resetSheets(basicTables(), { props: { SCRAPE_URL: 'https://down.test/' } });
    const before = env.sheets.Players.rows.length;
    syncPlayersFromWebsite(); // no url fixture -> mock throws -> catch branch
    assert.equal(env.sheets.Players.rows.length, before);
  });

  test('does nothing when voting is closed', () => {
    const tables = basicTables();
    tables.Settings[3] = ['VOTING_OPEN', 'FALSE'];
    const env = resetSheets(tables, { props: { SCRAPE_URL: 'https://example.test/' } });
    const before = env.sheets.Players.rows.length;
    syncPlayersFromWebsite();
    assert.equal(env.sheets.Players.rows.length, before);
  });

  test('avoids id collision when players have gaps', () => {
    const tables = basicTables();
    // Remove p4; keep p1,p2,p3,p5 (gap at p4). Old code used rows.length=5
    // (header+4 rows) → nextId = P005, colliding with p5.
    tables.Players = [
      ['ID', 'NAME', 'MELEE', 'EMAIL', 'ACTIVE'],
      ['p1', 'Alice', 'MAlice', 'alice@x.com', 'TRUE'],
      ['p2', 'Bob', 'MBob', 'bob@x.com', 'TRUE'],
      ['p3', 'Cara', 'MCara', '', 'TRUE'],
      ['p5', 'Eve', 'MEve', 'eve@x.com', 'TRUE']
    ];
    const env = resetSheets(tables, {
      props: { SCRAPE_URL: 'https://example.test/' },
      urlFixtures: {
        'https://example.test/': '<a href="/player/MAlice">Alice</a>' +
          '<a href="/player/MNew">New Player</a>'
      }
    });
    syncPlayersFromWebsite();
    const players = env.sheets.Players.rows;
    const newPlayer = players.find(r => r[1] === 'New Player');
    assert.ok(newPlayer, 'expected a new player row');
    // max existing id = 5 → next = 6 → P006 (not P005 which would collide).
    assert.equal(newPlayer[0], 'P006');
    // Original p5 remains intact.
    assert.ok(players.find(r => r[0] === 'p5'), 'p5 should still exist');
  });
});
