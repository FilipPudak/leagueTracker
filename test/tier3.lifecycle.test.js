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
    .map((p) => `{id:0,roundId:0,playerUsername:"${p.user}",playerName:"${p.name}",rank:${p.rank},points:0}`)
    .join(',');
  return `<html>foo standings:[${arr}],seasonWinCounts:{} bar</html>`;
}

describe('calculateSeasonAwards', () => {
  test('writes keyed award rows for the new award set', () => {
    // S1 data:
    //   OpponentVotes: p2 got 1, p1 got 1  -> Galactic Ambassador tie (p1, p2)
    //   LeaderVotes: p1 plays l1 & l2 (2 distinct), p2 plays l2 (1 distinct)
    //     Galactic Schemer (most distinct) -> p1
    //   Bounty Hunter is always prepopulated as an empty row (manual entry).
    const env = resetSheets(basicTables(), {
      urlFixtures: {
        [standingsUrl(1, 11)]: standingsHtml([{ user: 'MAlice', name: 'Alice', rank: 1 }])
      }
    });

    calculateSeasonAwards('S1');
    const rows = env.sheets.Awards.rows;
    const normalized = rows.slice(1).map((r) => [r[0], r[1], r[2]]);

    // Galactic Ambassador -> p1 and p2 (tie)
    assert.deepEqual(
      normalized.filter((r) => r[1] === 'Galactic Ambassador').sort(),
      [
        ['S1', 'Galactic Ambassador', 'p1'],
        ['S1', 'Galactic Ambassador', 'p2']
      ]
    );
    // Galactic Schemer -> p1
    assert.deepEqual(
      normalized.filter((r) => r[1] === 'Galactic Schemer'),
      [['S1', 'Galactic Schemer', 'p1']]
    );
    // Bounty Hunter placeholder -> empty playerId
    assert.deepEqual(
      normalized.filter((r) => r[1] === 'Bounty Hunter'),
      [['S1', 'Bounty Hunter', '']]
    );
    // Galactic Ruler -> p1 (rank 1 is MAlice)
    assert.deepEqual(
      normalized.filter((r) => r[1] === 'Galactic Ruler'),
      [['S1', 'Galactic Ruler', 'p1']]
    );
    // Only the final-round URL was given, so the midpoint fetch for A New Hope
    // fails and it is recorded as an empty placeholder rather than skipped.
    assert.deepEqual(
      normalized.filter((r) => r[1] === 'A New Hope'),
      [['S1', 'A New Hope', '']]
    );
  });

  test('records all tied winners for Galactic Ambassador', () => {
    const tables = basicTables();
    tables.OpponentVotes = [
      ['TS', 'SEASON_ID', 'WEEK', 'OPPONENT_ID'],
      ['2026-01-01', 'S1', 2, 'p3'],
      ['2026-01-01', 'S1', 2, 'p2']
    ];
    const env = resetSheets(tables);
    calculateSeasonAwards('S1');
    const amb = env.sheets.Awards.rows.slice(1).filter((r) => r[1] === 'Galactic Ambassador');
    assert.deepEqual(amb.map((r) => r[2]).sort(), ['p2', 'p3']);
  });

  test('Galactic Ruler records every player tied for rank 1', () => {
    const env = resetSheets(basicTables(), {
      urlFixtures: {
        [standingsUrl(1, 11)]: standingsHtml([
          { user: 'MAlice', name: 'Alice', rank: 1 },
          { user: 'MBob', name: 'Bob', rank: 1 }
        ])
      }
    });
    calculateSeasonAwards('S1');
    const ruler = env.sheets.Awards.rows.slice(1).filter((r) => r[1] === 'Galactic Ruler');
    assert.deepEqual(ruler.map((r) => r[2]).sort(), ['p1', 'p2']);
  });

  test('writes an empty placeholder for site awards with no matching player', () => {
    // A rank-1 player ('Stranger') is on the site but has no melee/name match in
    // our Players table, so Galactic Ruler is recorded as an empty placeholder
    // rather than a winner row (it is never skipped entirely).
    const env = resetSheets(basicTables(), {
      urlFixtures: {
        [standingsUrl(1, 11)]: standingsHtml([
          { user: 'Stranger', name: 'Stranger', rank: 1 }
        ])
      }
    });
    calculateSeasonAwards('S1');
    const labels = env.sheets.Awards.rows.slice(1).map((r) => r[1]);
    assert.ok(labels.includes('Galactic Ruler'));
    assert.deepEqual(
      env.sheets.Awards.rows.slice(1).filter((r) => r[1] === 'Galactic Ruler').map((r) => r[2]),
      ['']
    );
  });

  test('re-running the close does not duplicate award rows', () => {
    const env = resetSheets(basicTables(), {
      urlFixtures: {
        [standingsUrl(1, 11)]: standingsHtml([
          { user: 'MAlice', name: 'Alice', rank: 1 }
        ])
      }
    });

    calculateSeasonAwards('S1');
    const afterFirst = env.sheets.Awards.rows.map((r) => r.slice());
    calculateSeasonAwards('S1');
    assert.deepEqual(env.sheets.Awards.rows, afterFirst);
  });

  test('backfillSeasonAwards fills empty site awards without duplicating others', () => {
    // Simulate a close where the site was unreachable: Ruler/NewHope were
    // written as empty placeholders alongside the vote-based awards.
    const tables = basicTables();
    tables.Awards = [
      ['SEASON_ID', 'AWARD', 'PLAYER_ID'],
      ['S1', 'Galactic Ambassador', 'p1'],
      ['S1', 'Galactic Schemer', 'p1'],
      ['S1', 'Galactic Ruler', ''],
      ['S1', 'A New Hope', ''],
      ['S1', 'Bounty Hunter', '']
    ];
    // This time the site is reachable: MAlice is rank 1 at the end and climbed
    // from rank 3 at the midpoint.
    const env = resetSheets(tables, {
      urlFixtures: {
        [standingsUrl(1, 5)]: standingsHtml([
          { user: 'MAlice', name: 'Alice', rank: 3 }
        ]),
        [standingsUrl(1, 11)]: standingsHtml([
          { user: 'MAlice', name: 'Alice', rank: 1 }
        ])
      }
    });

    const result = backfillSeasonAwards();
    assert.equal(result.written, 2); // Galactic Ruler + A New Hope filled

    const dataRows = env.sheets.Awards.rows.slice(1);
    assert.deepEqual(
      dataRows.filter((r) => r[1] === 'Galactic Ruler'),
      [['S1', 'Galactic Ruler', 'p1']]
    );
    assert.deepEqual(
      dataRows.filter((r) => r[1] === 'A New Hope'),
      [['S1', 'A New Hope', 'p1']]
    );
    // Existing awards are not duplicated.
    assert.equal(dataRows.filter((r) => r[1] === 'Galactic Ambassador').length, 1);
    assert.equal(dataRows.filter((r) => r[1] === 'Galactic Schemer').length, 1);
    assert.equal(dataRows.filter((r) => r[1] === 'Bounty Hunter').length, 1);

    // Re-running the sweep is a no-op.
    const again = backfillSeasonAwards();
    assert.equal(again.written, 0);
    assert.deepEqual(env.sheets.Awards.rows.slice(1), dataRows);
  });

  test('A New Hope awards the most places climbed between midpoint and final round', () => {
    // Round 5 (midpoint): MAlice rank 5, MBob rank 1
    // Round 11 (final):   MAlice rank 2 (climbed 3), MBob rank 1 (unchanged),
    //                      MCara present only in round 11 (excluded).
    const env = resetSheets(basicTables(), {
      urlFixtures: {
        [standingsUrl(1, 5)]: standingsHtml([
          { user: 'MAlice', name: 'Alice', rank: 5 },
          { user: 'MBob', name: 'Bob', rank: 1 }
        ]),
        [standingsUrl(1, 11)]: standingsHtml([
          { user: 'MAlice', name: 'Alice', rank: 2 },
          { user: 'MBob', name: 'Bob', rank: 1 },
          { user: 'MCara', name: 'Cara', rank: 3 }
        ])
      }
    });
    calculateSeasonAwards('S1');
    const hope = env.sheets.Awards.rows.slice(1).filter((r) => r[1] === 'A New Hope');
    assert.deepEqual(hope.map((r) => r[2]).sort(), ['p1']);
  });

  test('A New Hope records all tied climbers and ignores flat/negative climbs', () => {
    // MAlice: rank 6 -> 4 (climbed 2); MBob: rank 5 -> 5 (no climb); MCara: rank 4 -> 2 (climbed 2).
    const env = resetSheets(basicTables(), {
      urlFixtures: {
        [standingsUrl(1, 5)]: standingsHtml([
          { user: 'MAlice', name: 'Alice', rank: 6 },
          { user: 'MBob', name: 'Bob', rank: 5 },
          { user: 'MCara', name: 'Cara', rank: 4 }
        ]),
        [standingsUrl(1, 11)]: standingsHtml([
          { user: 'MAlice', name: 'Alice', rank: 4 },
          { user: 'MBob', name: 'Bob', rank: 5 },
          { user: 'MCara', name: 'Cara', rank: 2 }
        ])
      }
    });
    calculateSeasonAwards('S1');
    const hope = env.sheets.Awards.rows.slice(1).filter((r) => r[1] === 'A New Hope');
    assert.deepEqual(hope.map((r) => r[2]).sort(), ['p1', 'p3']);
  });

  test('writes empty placeholders for site awards when the site is unreachable', () => {
    // No round URLs in urlFixtures -> fetchSeasonStandings returns null.
    const env = resetSheets(basicTables());
    calculateSeasonAwards('S1');
    const dataRows = env.sheets.Awards.rows.slice(1);
    const labels = dataRows.map((r) => r[1]);
    // All five awards get a row.
    [
      'Galactic Ambassador',
      'Galactic Schemer',
      'Galactic Ruler',
      'A New Hope',
      'Bounty Hunter'
    ].forEach((a) => assert.ok(labels.includes(a), `expected an award row for ${a}`));

    // Vote-based awards resolved; site-based + Bounty Hunter are placeholders.
    assert.ok(dataRows.some((r) => r[1] === 'Galactic Ambassador' && r[2] === 'p1'));
    assert.ok(dataRows.some((r) => r[1] === 'Galactic Schemer' && r[2] === 'p1'));
    assert.ok(dataRows.some((r) => r[1] === 'Galactic Ruler' && r[2] === ''));
    assert.ok(dataRows.some((r) => r[1] === 'A New Hope' && r[2] === ''));
    assert.ok(dataRows.some((r) => r[1] === 'Bounty Hunter' && r[2] === ''));
  });

  test('writes all five placeholder rows when a season has no votes and the site is unreachable', () => {
    const tables = basicTables();
    tables.LeaderVotes = [['TS', 'SEASON_ID', 'WEEK', 'PLAYER_ID', 'LEADER_ID']];
    tables.OpponentVotes = [['TS', 'SEASON_ID', 'WEEK', 'OPPONENT_ID']];
    const env = resetSheets(tables);

    calculateSeasonAwards('S1');
    const rows = env.sheets.Awards.rows.slice(1);
    assert.equal(rows.length, 5);
    rows.forEach((r) => {
      assert.equal(r[2], '');
    });
    assert.deepEqual(
      rows.map((r) => r[1]),
      ['Galactic Ambassador', 'Galactic Schemer', 'Galactic Ruler', 'A New Hope', 'Bounty Hunter']
    );
  });

  test('backfillSeasonAwards only sweeps seasons listed in the Seasons tab', () => {
    const tables = basicTables(); // Seasons: S1, S2
    tables.Awards = [
      ['SEASON_ID', 'AWARD', 'PLAYER_ID'],
      ['S1', 'Galactic Ruler', ''],
      ['S9', 'Galactic Ruler', '']
    ];
    const env = resetSheets(tables, {
      urlFixtures: {
        [standingsUrl(1, 11)]: standingsHtml([{ user: 'MAlice', name: 'Alice', rank: 1 }])
      }
    });

    backfillSeasonAwards();

    const rows = env.sheets.Awards.rows.slice(1);
    assert.deepEqual(
      rows.find((r) => r[0] === 'S1'),
      ['S1', 'Galactic Ruler', 'p1']
    );
    // S9 is not tracked in Seasons -> untouched.
    assert.deepEqual(
      rows.find((r) => r[0] === 'S9'),
      ['S9', 'Galactic Ruler', '']
    );
  });

  test('backfillSeasonAwards never writes Bounty Hunter', () => {
    const tables = basicTables();
    tables.Awards = [
      ['SEASON_ID', 'AWARD', 'PLAYER_ID'],
      ['S1', 'Bounty Hunter', '']
    ];
    const env = resetSheets(tables, {
      urlFixtures: {
        [standingsUrl(1, 11)]: standingsHtml([{ user: 'MAlice', name: 'Alice', rank: 1 }])
      }
    });

    const result = backfillSeasonAwards();
    assert.equal(result.written, 0);
    assert.deepEqual(env.sheets.Awards.rows.slice(1), [['S1', 'Bounty Hunter', '']]);
  });

  test('backfillSeasonAwards expands tied winners into multiple rows', () => {
    const tables = basicTables();
    tables.Awards = [
      ['SEASON_ID', 'AWARD', 'PLAYER_ID'],
      ['S1', 'Galactic Ruler', '']
    ];
    const env = resetSheets(tables, {
      urlFixtures: {
        [standingsUrl(1, 11)]: standingsHtml([
          { user: 'MAlice', name: 'Alice', rank: 1 },
          { user: 'MBob', name: 'Bob', rank: 1 }
        ])
      }
    });

    const result = backfillSeasonAwards();
    assert.equal(result.written, 2);
    const rulerRows = env.sheets.Awards.rows.slice(1).filter((r) => r[1] === 'Galactic Ruler');
    assert.deepEqual(rulerRows.map((r) => r[2]).sort(), ['p1', 'p2']);
  });

  test('close auto-sweeps empty award rows for the other tracked seasons', () => {
    // S2 closes now; S1 previously closed with an empty Ruler placeholder that
    // is resolvable once the site is back up.
    const tables = basicTables();
    tables.Settings = [
      ['KEY', 'VALUE'],
      ['ACTIVE_SEASON_ID', 'S2'],
      ['CURRENT_WEEK', 'Week 11'],
      ['VOTING_OPEN', 'TRUE'],
      ['SEASON_LENGTH', '11']
    ];
    tables.Awards = [
      ['SEASON_ID', 'AWARD', 'PLAYER_ID'],
      ['S1', 'Galactic Ruler', '']
    ];
    const env = resetSheets(tables, {
      urlFixtures: {
        [standingsUrl(1, 11)]: standingsHtml([{ user: 'MBob', name: 'Bob', rank: 1 }]),
        [standingsUrl(2, 11)]: standingsHtml([{ user: 'MAlice', name: 'Alice', rank: 1 }])
      }
    });

    const res = advanceLeagueWeek();
    assert.equal(res.message, 'Season 11 completed, voting closed, awards calculated.');

    const dataRows = env.sheets.Awards.rows.slice(1);
    // S1's empty Ruler was filled by the auto-sweep (Bob).
    assert.deepEqual(
      dataRows.find((r) => r[0] === 'S1' && r[1] === 'Galactic Ruler'),
      ['S1', 'Galactic Ruler', 'p2']
    );
    // S2's own award set was written by the close (Ruler = Alice).
    assert.deepEqual(
      dataRows.find((r) => r[0] === 'S2' && r[1] === 'Galactic Ruler'),
      ['S2', 'Galactic Ruler', 'p1']
    );
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

  test('closes the season at week 11 and calculates awards', () => {
    const tables = basicTables();
    tables.Settings = [
      ['KEY', 'VALUE'],
      ['ACTIVE_SEASON_ID', 'S2'],
      ['CURRENT_WEEK', 'Week 11'],
      ['VOTING_OPEN', 'TRUE'],
      ['SEASON_LENGTH', '11']
    ];
    // Give S2 week 10 an opponent winner so a Galactic Ambassador is produced.
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
    // Awards: all five rows written; no site fixtures -> Ruler/NewHope are
    // placeholders alongside the Bounty Hunter placeholder.
    const dataRows = env.sheets.Awards.rows.slice(1);
    assert.deepEqual(
      dataRows.find((r) => r[1] === 'Galactic Ambassador'),
      ['S2', 'Galactic Ambassador', 'p3']
    );
    assert.deepEqual(
      dataRows.find((r) => r[1] === 'Bounty Hunter'),
      ['S2', 'Bounty Hunter', '']
    );
    assert.deepEqual(
      dataRows.find((r) => r[1] === 'Galactic Ruler'),
      ['S2', 'Galactic Ruler', '']
    );
    assert.deepEqual(
      dataRows.find((r) => r[1] === 'A New Hope'),
      ['S2', 'A New Hope', '']
    );
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
    // Bounty Hunter placeholder still written at close.
    assert.ok(
      env.sheets.Awards.rows.slice(1).some((r) => r[1] === 'Bounty Hunter' && r[2] === ''),
      'expected Bounty Hunter placeholder'
    );
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
