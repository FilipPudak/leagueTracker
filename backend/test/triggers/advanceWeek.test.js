import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMockDb } from '../helpers/mock-db.js';
import { basicTables, closedVotingTables } from '../helpers/fixtures.js';
import { advanceWeek } from '../../src/triggers/advanceWeek.js';
import { getSetting, getSettings } from '../../src/db/queries.js';
import { enableFetchCache, disableFetchCache } from '../../src/lib/scraping.js';

function triggerTables() {
  const t = basicTables();
  t.settings = t.settings.map(s =>
    s.key === 'ACTIVE_SEASON_ID' ? { ...s, value: '6' } : s
  );
  return t;
}

function closedTriggerTables() {
  const t = closedVotingTables();
  t.settings = t.settings.map(s =>
    s.key === 'ACTIVE_SEASON_ID' ? { ...s, value: '6' } : s
  );
  return t;
}

const finalStandingsHtml =
  'standings:[{playerUsername:alice42,playerName:Alice,rank:1,points:100},{playerUsername:bob55,playerName:Bob,rank:2,points:90}],seasonWinCounts';

const midStandingsHtml =
  'standings:[{playerUsername:alice42,playerName:Alice,rank:3,points:50},{playerUsername:bob55,playerName:Bob,rank:1,points:70}],seasonWinCounts';

function makeStandingsFetch() {
  return async function fetch(url) {
    if (url.includes('/round/11')) {
      return { ok: true, status: 200, text: async () => finalStandingsHtml };
    }
    if (url.includes('/round/5')) {
      return { ok: true, status: 200, text: async () => midStandingsHtml };
    }
    return { ok: false, status: 404, text: async () => 'Not Found' };
  };
}

describe('triggers/advanceWeek', () => {
  let db;
  let originalFetch;

  beforeEach(() => {
    db = createMockDb(triggerTables());
    originalFetch = globalThis.fetch;
    enableFetchCache();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    disableFetchCache();
  });

  it('mid-season: advances week and reopens voting', async () => {
    globalThis.fetch = makeStandingsFetch();

    await advanceWeek({ DB: db });

    const settings = await getSettings(db);
    assert.equal(settings.CURRENT_WEEK, 'Week 4');
    assert.equal(settings.VOTING_OPEN, 'TRUE');
  });

  it('season end: closes voting and sets CURRENT_WEEK to Season Ended', async () => {
    db.getStore().settings.find(s => s.key === 'CURRENT_WEEK').value = '11';
    globalThis.fetch = makeStandingsFetch();

    await advanceWeek({ DB: db });

    const settings = await getSettings(db);
    assert.equal(settings.VOTING_OPEN, 'FALSE');
    assert.equal(settings.CURRENT_WEEK, 'Season Ended');
  });

  it('season end: materializes Schemer and Ambassador awards', async () => {
    db.getStore().settings.find(s => s.key === 'CURRENT_WEEK').value = '11';
    // Clear existing awards so we can verify they are written fresh
    db.getStore().awards = [];
    globalThis.fetch = makeStandingsFetch();

    await advanceWeek({ DB: db });

    const store = db.getStore();
    const schemer = store.awards.filter(a => a.award_name === 'Galactic Schemer');
    const ambassador = store.awards.filter(a => a.award_name === 'Galactic Ambassador');
    assert.ok(schemer.length > 0, 'Schemer awards were written');
    assert.ok(ambassador.length > 0, 'Ambassador awards were written');
  });

  it('season end: resolves Ruler player IDs from Melee names', async () => {
    db.getStore().settings.find(s => s.key === 'CURRENT_WEEK').value = '11';
    db.getStore().awards = [];
    globalThis.fetch = makeStandingsFetch();

    await advanceWeek({ DB: db });

    const store = db.getStore();
    const ruler = store.awards.filter(a => a.award_name === 'Galactic Ruler');
    assert.ok(ruler.length > 0, 'Ruler awards were written');
    assert.equal(ruler[0].player_id, 'P001', 'Resolved Alice melee name to player ID');
    assert.equal(ruler[0].score, 100);
  });

  it('skips when voting is closed', async () => {
    db = createMockDb(closedTriggerTables());
    let fetchCount = 0;
    globalThis.fetch = async () => {
      fetchCount++;
      return { ok: false, status: 404, text: async () => '' };
    };

    await advanceWeek({ DB: db });
    assert.equal(fetchCount, 0, 'No fetches when voting is closed');
  });
});
