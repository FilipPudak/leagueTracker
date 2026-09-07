import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMockDb } from '../helpers/mock-db.js';
import { basicTables, emptyTables } from '../helpers/fixtures.js';
import { handleStartNewSeason } from '../../src/handlers/startNewSeason.js';

describe('handleStartNewSeason', () => {
  let db;
  let env;

  beforeEach(() => {
    const tables = basicTables();
    db = createMockDb(tables);
    env = { DB: db, ADMIN_SECRET: 'test-secret-123' };
  });

  it('creates a new season and updates settings', async () => {
    const result = await handleStartNewSeason({ adminToken: 'test-secret-123' }, env);
    assert.equal(result.seasonId, 7);
    assert.equal(result.seasonName, 'Season 7');

    const store = db.getStore();
    const season = store.seasons.find(s => s.id === 7);
    assert.ok(season);
    assert.equal(season.name, 'Season 7');
    assert.ok(season.created_date);

    const activeSeason = store.settings.find(s => s.key === 'ACTIVE_SEASON_ID');
    assert.equal(activeSeason.value, '7');

    const currentWeek = store.settings.find(s => s.key === 'CURRENT_WEEK');
    assert.equal(currentWeek.value, 'Week 1');

    const votingOpen = store.settings.find(s => s.key === 'VOTING_OPEN');
    assert.equal(votingOpen.value, 'FALSE');

    const seasonStarted = store.settings.find(s => s.key === 'SEASON_STARTED');
    assert.equal(seasonStarted.value, 'TRUE');
  });

  it('rejects missing admin token', async () => {
    await assert.rejects(
      () => handleStartNewSeason({}, env),
      (err) => {
        assert.equal(err.status, 403);
        return true;
      }
    );
  });

  it('rejects wrong admin token', async () => {
    await assert.rejects(
      () => handleStartNewSeason({ adminToken: 'wrong-token' }, env),
      (err) => {
        assert.equal(err.status, 403);
        return true;
      }
    );
  });

  it('increments season ID from highest existing', async () => {
    const tables = basicTables();
    tables.seasons.push({ id: 10, name: 'Season 10', created_date: '2026-01-01' });
    db = createMockDb(tables);
    env = { DB: db, ADMIN_SECRET: 'test-secret-123' };

    const result = await handleStartNewSeason({ adminToken: 'test-secret-123' }, env);
    assert.equal(result.seasonId, 11);
    assert.equal(result.seasonName, 'Season 11');
  });

  it('works with empty seasons table', async () => {
    db = createMockDb(emptyTables());
    env = { DB: db, ADMIN_SECRET: 'test-secret-123' };

    const result = await handleStartNewSeason({ adminToken: 'test-secret-123' }, env);
    assert.equal(result.seasonId, 1);
    assert.equal(result.seasonName, 'Season 1');
  });
});
