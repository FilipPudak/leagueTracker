const { describe, test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadBackend, resetSheets } = require('./mockSheets.js');
const { basicTables } = require('./fixtures.js');

loadBackend();

describe('compileWeekSummary', () => {
  let env;
  beforeEach(() => {
    env = resetSheets(basicTables());
  });

  test('appends a summary row with the top leader of that week', () => {
    // S1 week 2: l1 x1, l2 x2 -> top leader l2 (Han - Solo is the name, but the
    // summary stores the leader ID + count).
    compileWeekSummary('S1', 2);
    const rows = env.sheets.SeasonSummary.rows;
    const last = rows[rows.length - 1];
    assert.equal(rows.length, 2); // header + one summary
    assert.equal(last[1], 'S1');
    assert.equal(last[2], 'Week 2');
    assert.equal(last[3], 'l2');
    assert.equal(last[4], 2);
  });

  test('records None / 0 when a week has no votes', () => {
    // S2 week 3 has no votes in the fixture.
    compileWeekSummary('S2', 3);
    const rows = env.sheets.SeasonSummary.rows;
    const last = rows[rows.length - 1];
    assert.equal(last[3], 'None');
    assert.equal(last[4], 0);
  });
});

describe('calculateSeasonAwards', () => {
  test('writes the Favorite Opponent award for the most-voted player', () => {
    // Build a fixture where p3 is clearly the favorite opponent in one season.
    const tables = basicTables();
    tables.OpponentVotes = [
      ['TS', 'SEASON_ID', 'WEEK', 'OPPONENT_ID', 'VOTER_ID'],
      ['2026-01-01', 'S1', 2, 'p3', 'p1'],
      ['2026-01-01', 'S1', 2, 'p3', 'p2'],
      ['2026-01-01', 'S1', 2, 'p2', 'p3']
    ];
    const env = resetSheets(tables);

    calculateSeasonAwards('S1');
    const rows = env.sheets.Awards.rows;
    assert.equal(rows.length, 2); // header + one award
    const award = rows[1];
    assert.equal(award[0], 'S1');
    assert.equal(award[1], 'Favorite Opponent');
    assert.equal(award[2], 'p3');
    assert.equal(award[3], 'Cara');
    assert.equal(award[4], '2 votes');
  });

  test('writes nothing when there are no opponent votes', () => {
    const tables = basicTables();
    tables.OpponentVotes = [['TS', 'SEASON_ID', 'WEEK', 'OPPONENT_ID', 'VOTER_ID']];
    const env = resetSheets(tables);
    calculateSeasonAwards('S1');
    assert.equal(env.sheets.Awards.rows.length, 1); // header only
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
    // A summary row was compiled for the completed week.
    assert.equal(env.sheets.SeasonSummary.rows.length, 2);
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
    assert.equal(env.sheets.SeasonSummary.rows.length, 1);
  });

  test('closes the season at week 11 and calculates awards', () => {
    const tables = basicTables();
    tables.Settings = [
      ['KEY', 'VALUE'],
      ['ACTIVE_SEASON_ID', 'S2'],
      ['CURRENT_WEEK', 'Week 11'],
      ['VOTING_OPEN', 'TRUE']
    ];
    // Give S2 week 10 an opponent winner so an award is produced.
    tables.OpponentVotes = [
      ['TS', 'SEASON_ID', 'WEEK', 'OPPONENT_ID', 'VOTER_ID'],
      ['2026-01-01', 'S2', 10, 'p3', 'p1'],
      ['2026-01-01', 'S2', 10, 'p3', 'p2']
    ];
    const env = resetSheets(tables);

    const res = advanceLeagueWeek();
    assert.equal(res.success, true);
    assert.equal(res.message, 'Season 11 completed, voting closed, awards calculated.');
    const settings = getSettings();
    assert.equal(settings.VOTING_OPEN, 'FALSE');
    assert.equal(settings.CURRENT_WEEK, 'Season Ended');
    // An award row was appended for the favorite opponent p3.
    assert.equal(env.sheets.Awards.rows.length, 2);
    assert.equal(env.sheets.Awards.rows[1][2], 'p3');
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
  test('adds new players, updates names, and links them to the active season', () => {
    const env = resetSheets(basicTables(), {
      props: { SCRAPE_URL: 'https://example.test/' },
      urlFixtures: {
        'https://example.test/': '<a href="/player/MAlice">Alice Updated</a>' +
          '<a href="/player/MNew">New Player</a>'
      }
    });

    syncPlayersFromWebsite();

    const players = env.sheets.Players.rows;
    // Existing player p1 (melee MAlice) name updated.
    const alice = players.find((r) => r[0] === 'p1');
    assert.equal(alice[1], 'Alice Updated');
    // A brand-new player was appended with a generated id.
    const added = players.find((r) => r[1] === 'New Player');
    assert.ok(added, 'expected a new player row');
    assert.equal(added[2], 'MNew');
    assert.equal(added[4], 'TRUE');
    // The new player was linked to the active season (S2).
    const sp = env.sheets.SeasonPlayers.rows.find(
      (r) => r[0] === 'S2' && r[1] === added[0]
    );
    assert.ok(sp, 'expected new player linked to S2');
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
});
