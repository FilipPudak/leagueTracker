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
} from '../../src/db/queries.js';

describe('db/queries', () => {
  let db;

  beforeEach(() => {
    db = createMockDb(basicTables());
  });

  it('getSettings returns key-value object from settings table', async () => {
    const settings = await getSettings(db);
    assert.equal(settings.ACTIVE_SEASON_ID, 'S6');
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
});
