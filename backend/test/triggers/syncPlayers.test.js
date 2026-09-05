import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMockDb } from '../helpers/mock-db.js';
import { basicTables, closedVotingTables } from '../helpers/fixtures.js';
import { syncPlayers } from '../../src/triggers/syncPlayers.js';
import { enableFetchCache, disableFetchCache } from '../../src/lib/scraping.js';

const BASE = 'https://stockholm.sw-unlimited.com/';

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

const playerListHtml = `
  <div>
    <a href="/player/alice42">Alice</a>
    <a href="/player/bob55">Bob</a>
    <a href="/player/newguy99">NewGuy</a>
  </div>
`;

const standingsHtml = `
  standings:[{playerUsername:alice42,playerName:Alice,rank:1,points:100},{playerUsername:bob55,playerName:Bob,rank:2,points:90}],seasonWinCounts
`;

function makeFetchHandler(overrides = {}) {
  return async function fetch(url) {
    if (url === BASE) {
      return { ok: true, status: 200, text: async () => overrides.playerList ?? playerListHtml };
    }
    if (url.includes('/season/')) {
      return { ok: true, status: 200, text: async () => overrides.standings ?? standingsHtml };
    }
    return { ok: false, status: 404, text: async () => 'Not Found' };
  };
}

describe('triggers/syncPlayers', () => {
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

  it('syncs new players from fetched player list', async () => {
    globalThis.fetch = makeFetchHandler();

    await syncPlayers({ DB: db });

    const store = db.getStore();
    const newPlayer = store.players.find(p => p.melee_name === 'newguy99');
    assert.ok(newPlayer, 'New player was inserted');
    assert.equal(newPlayer.name, 'NewGuy');
  });

  it('updates existing player name when changed', async () => {
    globalThis.fetch = makeFetchHandler({
      playerList: `
        <a href="/player/alice42">Alice Updated</a>
        <a href="/player/bob55">Bob</a>
      `,
    });

    await syncPlayers({ DB: db });

    const store = db.getStore();
    const alice = store.players.find(p => p.melee_name === 'alice42');
    assert.equal(alice.name, 'Alice Updated');
  });

  it('records attendance from standings for the current week', async () => {
    globalThis.fetch = makeFetchHandler();

    await syncPlayers({ DB: db });

    const store = db.getStore();
    const week3 = store.attendance.filter(a => a.season_id === 6 && a.week === 3);
    assert.ok(week3.length >= 2, 'Attendance recorded for week 3');
    const playerIds = week3.map(a => a.player_id);
    assert.ok(playerIds.includes('P001'), 'Alice attendance recorded');
    assert.ok(playerIds.includes('P002'), 'Bob attendance recorded');
  });

  it('skips entirely when voting is closed', async () => {
    db = createMockDb(closedTriggerTables());
    let fetchCount = 0;
    globalThis.fetch = async () => {
      fetchCount++;
      return { ok: true, status: 200, text: async () => '' };
    };

    await syncPlayers({ DB: db });
    assert.equal(fetchCount, 0, 'No external fetches when voting is closed');
  });

  it('skips when fetchPlayerList returns null (site unreachable)', async () => {
    globalThis.fetch = async () => ({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    });

    const storeBefore = JSON.stringify(db.getStore().players);
    await syncPlayers({ DB: db });
    const storeAfter = JSON.stringify(db.getStore().players);
    assert.equal(storeBefore, storeAfter, 'No players changed when site is unreachable');
  });

  it('makes fetch calls to the correct URLs', async () => {
    const fetchedUrls = [];
    globalThis.fetch = async (url) => {
      fetchedUrls.push(url);
      if (url === BASE) {
        return { ok: true, status: 200, text: async () => playerListHtml };
      }
      if (url.includes('/season/')) {
        return { ok: true, status: 200, text: async () => standingsHtml };
      }
      return { ok: false, status: 404, text: async () => 'Not Found' };
    };

    await syncPlayers({ DB: db });

    assert.ok(fetchedUrls.some(u => u === BASE), 'Fetched player list homepage');
    assert.ok(
      fetchedUrls.some(u => u.includes('/season/6/round/3')),
      'Fetched season standings for season 6 week 3'
    );
  });
});
