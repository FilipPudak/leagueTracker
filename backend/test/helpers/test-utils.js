// Test utility: creates a fully-wired env object for handler/trigger tests.

import { createMockDb } from './mock-db.js';
import { createFetchMock } from './mock-fetch.js';
import { installCryptoMock, uninstallCryptoMock, resetCryptoCounter } from './mock-crypto.js';
import { basicTables } from './fixtures.js';

let _fetchMock = null;

export function createTestEnv(tables) {
  const db = createMockDb(tables || basicTables());
  const fetchMock = createFetchMock();
  _fetchMock = fetchMock;

  // Install crypto mock
  installCryptoMock();

  // Mock global fetch
  globalThis._originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock.handler;

  return {
    DB: db,
    fetchMock,
    db,
  };
}

export function cleanupTestEnv() {
  if (_fetchMock) _fetchMock.reset();
  uninstallCryptoMock();
  if (globalThis._originalFetch) {
    globalThis.fetch = globalThis._originalFetch;
    delete globalThis._originalFetch;
  }
}

export function resetTestEnv(env, tables) {
  const newDb = createMockDb(tables || basicTables());
  env.DB = newDb;
  env.db = newDb;
  env.fetchMock.reset();
  resetCryptoCounter();
  return env;
}
