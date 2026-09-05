import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createFetchMock } from '../helpers/mock-fetch.js';
import {
  fetchSeasonStandings,
  fetchPlayerList,
  enableFetchCache,
  disableFetchCache,
} from '../../src/lib/scraping.js';

const STANDINGS_HTML = `<html><body>
<script type="application/json">{"data":{standings:[{playerUsername:alice42,playerName:Alice,rank:1,points:150},{playerUsername:bob55,playerName:Bob,rank:2,points:120},{playerUsername:charlie99,playerName:Charlie,rank:3,points:90}],seasonWinCounts:{}}}</script>
</body></html>`;

const PLAYER_LIST_HTML = `
<html><body>
<a href="/player/alice42">Alice</a>
<a href="/player/bob55">Bob</a>
<a href="/player/charlie99">Charlie</a>
</body></html>
`;

let fm;
let originalFetch;

describe('fetchSeasonStandings', () => {
  beforeEach(() => {
    fm = createFetchMock();
    originalFetch = globalThis.fetch;
    globalThis.fetch = fm.handler;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    disableFetchCache();
    fm.reset();
  });

  it('parses standings from valid HTML', async () => {
    fm.setResponse('https://stockholm.sw-unlimited.com/season/6/round/3', STANDINGS_HTML);
    const result = await fetchSeasonStandings(6, 3);
    assert.ok(Array.isArray(result));
    assert.equal(result.length, 3);
    assert.equal(result[0].username, 'alice42');
    assert.equal(result[0].name, 'Alice');
    assert.equal(result[0].rank, 1);
    assert.equal(result[0].points, 150);
    assert.equal(result[1].username, 'bob55');
    assert.equal(result[1].points, 120);
    assert.equal(result[2].username, 'charlie99');
    assert.equal(result[2].points, 90);
  });

  it('returns null for malformed HTML with no standings', async () => {
    fm.setResponse('https://stockholm.sw-unlimited.com/season/6/round/3', '<html><body>No data here</body></html>');
    const result = await fetchSeasonStandings(6, 3);
    assert.equal(result, null);
  });

  it('returns null for empty standings array in HTML', async () => {
    fm.setResponse('https://stockholm.sw-unlimited.com/season/6/round/3',
      '<html><body>standings:[],seasonWinCounts:{}</body></html>');
    const result = await fetchSeasonStandings(6, 3);
    assert.equal(result, null);
  });

  it('returns null on network error', async () => {
    fm.setError('https://stockholm.sw-unlimited.com/season/6/round/3', 'Network failure');
    const result = await fetchSeasonStandings(6, 3);
    assert.equal(result, null);
  });

  it('returns null on non-ok HTTP response', async () => {
    fm.setDefault(() => ({
      ok: false,
      status: 500,
      async text() { return 'Server Error'; },
    }));
    const result = await fetchSeasonStandings(6, 3);
    assert.equal(result, null);
  });

  it('constructs correct URL from season and round numbers', async () => {
    fm.setResponse('https://stockholm.sw-unlimited.com/season/8/round/1', STANDINGS_HTML);
    await fetchSeasonStandings(8, 1);
    assert.equal(fm.getFetchCount('https://stockholm.sw-unlimited.com/season/8/round/1'), 1);
  });
});

describe('fetchPlayerList', () => {
  beforeEach(() => {
    fm = createFetchMock();
    originalFetch = globalThis.fetch;
    globalThis.fetch = fm.handler;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    disableFetchCache();
    fm.reset();
  });

  it('parses player links from valid HTML', async () => {
    fm.setResponse('https://stockholm.sw-unlimited.com/', PLAYER_LIST_HTML);
    const result = await fetchPlayerList();
    assert.ok(result instanceof Map);
    assert.equal(result.size, 3);
    assert.deepEqual(result.get('alice42'), { meleeName: 'alice42', name: 'Alice' });
    assert.deepEqual(result.get('bob55'), { meleeName: 'bob55', name: 'Bob' });
    assert.deepEqual(result.get('charlie99'), { meleeName: 'charlie99', name: 'Charlie' });
  });

  it('returns null when no player links found', async () => {
    fm.setResponse('https://stockholm.sw-unlimited.com/', '<html><body>No players</body></html>');
    const result = await fetchPlayerList();
    assert.equal(result, null);
  });

  it('returns null on network error', async () => {
    fm.setError('https://stockholm.sw-unlimited.com/', 'Connection refused');
    const result = await fetchPlayerList();
    assert.equal(result, null);
  });

  it('returns null on non-ok HTTP response', async () => {
    fm.setDefault(() => ({
      ok: false,
      status: 403,
      async text() { return 'Forbidden'; },
    }));
    const result = await fetchPlayerList();
    assert.equal(result, null);
  });

  it('stores player names with correct casing in Map keys', async () => {
    fm.setResponse('https://stockholm.sw-unlimited.com/', PLAYER_LIST_HTML);
    const result = await fetchPlayerList();
    assert.ok(result.has('alice42'));
    assert.ok(!result.has('Alice42'));
  });
});

describe('fetch cache', () => {
  beforeEach(() => {
    fm = createFetchMock();
    originalFetch = globalThis.fetch;
    globalThis.fetch = fm.handler;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    disableFetchCache();
    fm.reset();
  });

  it('second call to same URL does not hit global fetch again', async () => {
    enableFetchCache();
    fm.setResponse('https://stockholm.sw-unlimited.com/season/6/round/3', STANDINGS_HTML);
    await fetchSeasonStandings(6, 3);
    assert.equal(fm.getFetchCount('https://stockholm.sw-unlimited.com/season/6/round/3'), 1);
    await fetchSeasonStandings(6, 3);
    assert.equal(fm.getFetchCount('https://stockholm.sw-unlimited.com/season/6/round/3'), 1);
  });

  it('different URLs are fetched separately even with cache enabled', async () => {
    enableFetchCache();
    fm.setResponse('https://stockholm.sw-unlimited.com/season/6/round/3', STANDINGS_HTML);
    fm.setResponse('https://stockholm.sw-unlimited.com/season/6/round/4', STANDINGS_HTML);
    await fetchSeasonStandings(6, 3);
    await fetchSeasonStandings(6, 4);
    assert.equal(fm.getFetchCount('https://stockholm.sw-unlimited.com/season/6/round/3'), 1);
    assert.equal(fm.getFetchCount('https://stockholm.sw-unlimited.com/season/6/round/4'), 1);
  });

  it('without cache enabled, same URL is fetched each time', async () => {
    fm.setResponse('https://stockholm.sw-unlimited.com/season/6/round/3', STANDINGS_HTML);
    await fetchSeasonStandings(6, 3);
    await fetchSeasonStandings(6, 3);
    assert.equal(fm.getFetchCount('https://stockholm.sw-unlimited.com/season/6/round/3'), 2);
  });

  it('disableFetchCache clears the cache', async () => {
    enableFetchCache();
    fm.setResponse('https://stockholm.sw-unlimited.com/season/6/round/3', STANDINGS_HTML);
    await fetchSeasonStandings(6, 3);
    assert.equal(fm.getFetchCount('https://stockholm.sw-unlimited.com/season/6/round/3'), 1);
    disableFetchCache();
    await fetchSeasonStandings(6, 3);
    assert.equal(fm.getFetchCount('https://stockholm.sw-unlimited.com/season/6/round/3'), 2);
  });

  it('player list also benefits from cache', async () => {
    enableFetchCache();
    fm.setResponse('https://stockholm.sw-unlimited.com/', PLAYER_LIST_HTML);
    await fetchPlayerList();
    await fetchPlayerList();
    assert.equal(fm.getFetchCount('https://stockholm.sw-unlimited.com/'), 1);
  });
});
