const { describe, test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadBackend, resetSheets } = require('./mockSheets.js');
const { basicTables } = require('./fixtures.js');

loadBackend();

describe('calculateSeasonAwards', () => {
  test('writes keyed award rows (seasonId, award, playerId)', () => {
    // Base fixture S1 data:
    //   OpponentVotes: p2 got 1, p1 got 1  -> Favorite Opponent tie (p1, p2)
    //   LeaderVotes: p1 plays l1 & l2 (2 distinct), p2 plays l2 (1 distinct)
    //     Diversity (most distinct) -> p1
    //     Loyalty (most single-leader nights): p1 best=1, p2 best=1 -> tie -> both
    const env = resetSheets(basicTables());

    calculateSeasonAwards('S1');
    const rows = env.sheets.Awards.rows;
    assert.equal(rows.length, 6); // header + 5 award rows
    const normalized = rows.slice(1).map((r) => [r[0], r[1], r[2]]);

    // Favorite Opponent -> p1 and p2 (tie)
    assert.deepEqual(
      normalized.filter((r) => r[1] === 'Favorite Opponent').sort(),
      [
        ['S1', 'Favorite Opponent', 'p1'],
        ['S1', 'Favorite Opponent', 'p2']
      ]
    );
    // Diversity -> p1
    assert.deepEqual(
      normalized.filter((r) => r[1] === 'Diversity'),
      [['S1', 'Diversity', 'p1']]
    );
    // Loyalty -> p1 and p2 (tie)
    assert.deepEqual(
      normalized.filter((r) => r[1] === 'Loyalty').sort(),
      [
        ['S1', 'Loyalty', 'p1'],
        ['S1', 'Loyalty', 'p2']
      ]
    );
  });

  test('records all tied winners for an award', () => {
    const tables = basicTables();
    // Make favorite opponent a tie between p3 and p2.
    tables.OpponentVotes = [
      ['TS', 'SEASON_ID', 'WEEK', 'OPPONENT_ID'],
      ['2026-01-01', 'S1', 2, 'p3'],
      ['2026-01-01', 'S1', 2, 'p2']
    ];
    const env = resetSheets(tables);
    calculateSeasonAwards('S1');
    const fav = env.sheets.Awards.rows.slice(1).filter((r) => r[1] === 'Favorite Opponent');
    assert.deepEqual(fav.map((r) => r[2]).sort(), ['p2', 'p3']);
  });

  test('writes nothing when a season has no votes at all', () => {
    const tables = basicTables();
    tables.LeaderVotes = [['TS', 'SEASON_ID', 'WEEK', 'PLAYER_ID', 'LEADER_ID']];
    tables.OpponentVotes = [['TS', 'SEASON_ID', 'WEEK', 'OPPONENT_ID']];
    const env = resetSheets(tables);
    calculateSeasonAwards('S2'); // S2 has no vote rows
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
});
