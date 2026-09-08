import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMockDb } from '../helpers/mock-db.js';
import { basicTables } from '../helpers/fixtures.js';
import {
  getSettings,
  getSetting,
  updateSetting,
  getPlayerById,
  getPlayerByEmail,
  getAllActivePlayers,
  getAllActiveLeaders,
  getAllSeasons,
  getSessionByToken,
  getAwardsForSeason,
  getMostPlayedLeaders,
  getMaxSeasonId,
  isVotingOpen,
  parseSeasonId,
  parseWeek,
  isSeasonStarted,
  findPlayerByMelee,
  hasPlayerVotedThisWeek,
} from '../../src/db/queries.js';

describe('db/queries', () => {
  let db;

  beforeEach(() => {
    db = createMockDb(basicTables());
  });

  it('getSettings returns key-value object from settings table', async () => {
    const settings = await getSettings(db);
    assert.equal(settings.ACTIVE_SEASON_ID, '6');
    assert.equal(settings.CURRENT_WEEK, 'Week 3');
    assert.equal(settings.VOTING_OPEN, 'TRUE');
    assert.equal(settings.SEASON_LENGTH, '11');
    assert.equal(settings.TIMEZONE, 'Europe/Stockholm');
  });

  it('getSetting returns value for specific key', async () => {
    const val = await getSetting(db, 'CURRENT_WEEK');
    assert.equal(val, 'Week 3');
  });

  it('getSetting returns null for unknown key', async () => {
    const val = await getSetting(db, 'NONEXISTENT_KEY');
    assert.ok(!val);
  });

  it('updateSetting inserts a new key', async () => {
    await updateSetting(db, 'BRAND_NEW_KEY', 'brand_new_value');
    const val = await getSetting(db, 'BRAND_NEW_KEY');
    assert.equal(val, 'brand_new_value');
  });

  it('updateSetting updates existing key (getSettings sees latest value)', async () => {
    await updateSetting(db, 'CURRENT_WEEK', 'Week 4');
    const settings = await getSettings(db);
    assert.equal(settings.CURRENT_WEEK, 'Week 4');
  });

  it('getPlayerById returns player or undefined', async () => {
    const player = await getPlayerById(db, 'P001');
    assert.equal(player.name, 'Alice');
    assert.equal(player.melee_name, 'alice42');

    const missing = await getPlayerById(db, 'P999');
    assert.ok(!missing);
  });

  it('getPlayerByEmail does case-insensitive lookup', async () => {
    const upper = await getPlayerByEmail(db, 'ALICE@TEST.COM');
    assert.equal(upper.id, 'P001');

    const mixed = await getPlayerByEmail(db, 'BoB@Test.Com');
    assert.equal(mixed.id, 'P002');
  });

  it('getPlayerByEmail returns falsy for non-existent email', async () => {
    const missing = await getPlayerByEmail(db, 'nobody@test.com');
    assert.ok(!missing);
  });

  it('getPlayerByEmail returns null for falsy email', async () => {
    assert.ok(!(await getPlayerByEmail(db, null)));
    assert.ok(!(await getPlayerByEmail(db, '')));
    assert.ok(!(await getPlayerByEmail(db, undefined)));
  });

  it('getAllActivePlayers returns only active=1 players', async () => {
    const { results } = await getAllActivePlayers(db);
    assert.equal(results.length, 4);
    assert.ok(results.every(p => p.active === 1));
    const names = results.map(p => p.name).sort();
    assert.deepEqual(names, ['Alice', 'Bob', 'Charlie', 'Diana']);
  });

  it('getAllActiveLeaders returns only active=1 leaders', async () => {
    const { results } = await getAllActiveLeaders(db);
    assert.equal(results.length, 3);
    assert.ok(results.every(l => l.active === 1));
    const names = results.map(l => l.name).sort();
    assert.deepEqual(names, ['Ahsoka Tano', 'Darth Vader', 'Luke Skywalker']);
  });

  it('getAllSeasons returns all seasons ordered by id DESC', async () => {
    const { results } = await getAllSeasons(db);
    assert.equal(results.length, 2);
    assert.equal(results[0].id, 6);
    assert.equal(results[1].id, 5);
  });

  it('getSessionByToken returns session or undefined', async () => {
    const session = await getSessionByToken(db, 'test-token-alice');
    assert.equal(session.player_id, 'P001');
    assert.equal(session.email, 'alice@test.com');

    const missing = await getSessionByToken(db, 'nonexistent-token');
    assert.ok(!missing);
  });

  it('getSessionByToken returns falsy for falsy token', async () => {
    assert.ok(!(await getSessionByToken(db, null)));
    assert.ok(!(await getSessionByToken(db, '')));
  });

  it('getAwardsForSeason returns awards for given season', async () => {
    const { results } = await getAwardsForSeason(db, 6);
    assert.ok(results.length > 0);
    assert.ok(results.every(a => a.season_id === 6));

    const awardNames = [...new Set(results.map(a => a.award_name))];
    assert.ok(awardNames.includes('Galactic Schemer'));
    assert.ok(awardNames.includes('Galactic Ambassador'));
  });

  it('getAwardsForSeason returns empty for unknown season', async () => {
    const { results } = await getAwardsForSeason(db, 999);
    assert.equal(results.length, 0);
  });

  it('getMostPlayedLeaders runs without error and returns array', async () => {
    const { results } = await getMostPlayedLeaders(db, 6);
    assert.ok(Array.isArray(results));
  });

  it('getMaxSeasonId returns highest season ID', async () => {
    const maxId = await getMaxSeasonId(db);
    assert.equal(maxId, 6, 'highest season is 6');
  });

  describe('isVotingOpen', () => {
    it('accepts TRUE', () => assert.equal(isVotingOpen('TRUE'), true));
    it('accepts YES', () => assert.equal(isVotingOpen('YES'), true));
    it('accepts 1', () => assert.equal(isVotingOpen('1'), true));
    it('accepts true (boolean)', () => assert.equal(isVotingOpen(true), true));
    it('accepts case-insensitive True', () => assert.equal(isVotingOpen('True'), true));
    it('rejects FALSE', () => assert.equal(isVotingOpen('FALSE'), false));
    it('rejects empty string', () => assert.equal(isVotingOpen(''), false));
    it('rejects null', () => assert.equal(isVotingOpen(null), false));
    it('rejects undefined', () => assert.equal(isVotingOpen(undefined), false));
  });

  describe('parseSeasonId', () => {
    it('parses numeric string "6"', () => assert.equal(parseSeasonId('6'), 6));
    it('parses prefixed string "S6"', () => assert.equal(parseSeasonId('S6'), 6));
    it('parses "Season 12"', () => assert.equal(parseSeasonId('Season 12'), 12));
    it('parses number 6', () => assert.equal(parseSeasonId(6), 6));
    it('parses "S100"', () => assert.equal(parseSeasonId('S100'), 100));
    it('returns null for null', () => assert.equal(parseSeasonId(null), null));
    it('returns null for undefined', () => assert.equal(parseSeasonId(undefined), null));
    it('returns null for empty string', () => assert.equal(parseSeasonId(''), null));
    it('returns null for non-numeric string', () => assert.equal(parseSeasonId('Season Ended'), null));
  });

  describe('parseWeek', () => {
    it('parses numeric string "3"', () => assert.equal(parseWeek('3'), 3));
    it('parses "Week 5"', () => assert.equal(parseWeek('Week 5'), 5));
    it('parses number 7', () => assert.equal(parseWeek(7), 7));
    it('returns null for null', () => assert.equal(parseWeek(null), null));
    it('returns null for undefined', () => assert.equal(parseWeek(undefined), null));
    it('returns null for empty string', () => assert.equal(parseWeek(''), null));
    it('returns null for non-numeric string', () => assert.equal(parseWeek('Season Ended'), null));
  });

  describe('isSeasonStarted', () => {
    it('accepts TRUE', () => assert.equal(isSeasonStarted('TRUE'), true));
    it('accepts YES', () => assert.equal(isSeasonStarted('YES'), true));
    it('accepts 1', () => assert.equal(isSeasonStarted('1'), true));
    it('accepts true (boolean)', () => assert.equal(isSeasonStarted(true), true));
    it('accepts case-insensitive True', () => assert.equal(isSeasonStarted('True'), true));
    it('rejects FALSE', () => assert.equal(isSeasonStarted('FALSE'), false));
    it('rejects empty string', () => assert.equal(isSeasonStarted(''), false));
    it('rejects null', () => assert.equal(isSeasonStarted(null), false));
    it('rejects undefined', () => assert.equal(isSeasonStarted(undefined), false));
    it('rejects missing key (undefined from getSetting)', () => assert.equal(isSeasonStarted(undefined), false));
  });

  describe('findPlayerByMelee', () => {
    it('found → returns player ID', async () => {
      const result = await findPlayerByMelee(db, 'alice42');
      assert.equal(result, 'P001');
    });

    it('not found → returns null', async () => {
      const result = await findPlayerByMelee(db, 'nonexistent');
      assert.equal(result, null);
    });
  });

  describe('hasPlayerVotedThisWeek', () => {
    it('has voted → returns true', async () => {
      const result = await hasPlayerVotedThisWeek(db, 6, 1, 'P001');
      assert.equal(result, true);
    });

    it('has not voted → returns false', async () => {
      const result = await hasPlayerVotedThisWeek(db, 6, 1, 'P005');
      assert.equal(result, false);
    });
  });
});
