/**
 * In-memory Google Apps Script mock + backend loader for tests.
 *
 * The backend is loaded ONCE into the host realm (via vm.runInThisContext) so
 * that `instanceof Error` and assert.deepStrictEqual behave normally. Because
 * top-level `const SPREADSHEET_ID` etc. can't be re-declared, per-test isolation
 * is achieved by swapping the underlying sheets/props/urlFixtures through a
 * mutable registry that the mock closures read at call time.
 */

function makeSheet(headerAndRows) {
  const grid = headerAndRows.map((row) => row.slice());
  let dataRangeCalls = 0;

  return {
    _grid: grid,
    _dataRangeCalls: () => dataRangeCalls,
    getLastRow() {
      return grid.length;
    },
    getDataRange() {
      dataRangeCalls++;
      return {
        getValues() {
          return grid.map((row) => row.slice());
        }
      };
    },
    getRange(row, col, numRows, numCols) {
      return new RangeRef(grid, row, col, numRows, numCols);
    },
    appendRow(values) {
      grid.push(values.slice());
    },
    deleteRow(rowIndex) {
      if (rowIndex >= 1 && rowIndex <= grid.length) {
        grid.splice(rowIndex - 1, 1);
      }
    },
    get rows() {
      return grid;
    }
  };
}

class RangeRef {
  constructor(grid, startRow, startCol, numRows = 1, numCols = 1) {
    this.grid = grid;
    this.startRow = startRow;
    this.startCol = startCol;
    this.numRows = numRows || 1;
    this.numCols = numCols || 1;
  }
  setValue(value) {
    this._ensure(this.startRow - 1, this.startCol - 1);
    this.grid[this.startRow - 1][this.startCol - 1] = value;
  }
  setValues(values2d) {
    values2d.forEach((row, dr) => {
      row.forEach((cell, dc) => {
        const r = this.startRow - 1 + dr;
        const c = this.startCol - 1 + dc;
        this._ensure(r, c);
        this.grid[r][c] = cell;
      });
    });
  }
  _ensure(r, c) {
    while (this.grid.length <= r) this.grid.push([]);
    while (this.grid[r].length <= c) this.grid[r].push(null);
  }
}

// Mutable registry referenced by the installed mock closures.
let registry = null;

function resetSheets(tables, opts = {}) {
  if (!registry) throw new Error('Call loadBackend() first.');
  const sheets = {};
  Object.keys(tables).forEach((name) => {
    sheets[name] = makeSheet(tables[name]);
  });
  const ss = {
    getSheetByName(name) {
      return sheets[name] || null;
    },
    getSheets() {
      return Object.keys(sheets).map((n) => sheets[n]);
    },
    _sheets: sheets
  };
  registry.sheets = sheets;
  registry.ss = ss;
  registry.props = Object.assign(
    { SPREADSHEET_ID: 'TEST', API_SECRET: 'test-secret' },
    opts.props || {}
  );
  registry.urlFixtures = opts.urlFixtures || {};
  registry.state.openCount = 0;
  registry.state.scriptLockGranted = true;
  registry.state.scriptLockWaited = false;
  registry.state.tryLockCalls = 0;
  registry.state.siteFetches = 0;
  return { ss, sheets, state: registry.state };
}

function installMocks() {
  registry = {
    sheets: {},
    ss: null,
    // Defaults must be present BEFORE load so the top-level consts
    // SPREADSHEET_ID / API_SECRET resolve during vm.runInThisContext.
    props: { SPREADSHEET_ID: 'TEST', API_SECRET: 'test-secret' },
    urlFixtures: {},
    state: { openCount: 0, scriptLockGranted: true, scriptLockWaited: false, tryLockCalls: 0, siteFetches: 0 }
  };

  global.__TEST_REGISTRY__ = registry;

  global.SpreadsheetApp = {
    openById() {
      registry.state.openCount++;
      return registry.ss;
    }
  };

  global.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (key) => {
        const v = registry.props[key];
        return v !== undefined ? v : null;
      }
    })
  };

  global.ContentService = {
    createTextOutput: (data) => ({
      setMimeType: () => ({
        toString: () => data
      })
    }),
    MimeType: { JSON: 'application/json' }
  };

  global.Session = {
    getScriptTimeZone: () => 'Europe/Berlin'
  };

  global.Utilities = {
    formatDate: (date, timezone, format) => {
      const pad = (n) => String(n).padStart(2, '0');
      if (format === 'yyyy-MM-dd') {
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
      }
      return String(date);
    }
  };

  global.LockService = {
    getScriptLock: () => ({
      tryLock: () => { registry.state.tryLockCalls++; return registry.state.scriptLockGranted; },
      waitLock: () => {
        registry.state.scriptLockWaited = true;
      },
      releaseLock: () => {}
    })
  };

  global.UrlFetchApp = {
    fetch: (url) => {
      registry.state.siteFetches++;
      const body = registry.urlFixtures[url];
      if (body === undefined) {
        const err = new Error('NETWORK_ERROR');
        err.throwActual = true;
        throw err;
      }
      return {
        getResponseCode: () => 200,
        getContentText: () => body
      };
    }
  };
}

let loaded = false;

/**
 * Loads backend/Code.gs into the host global once.
 * Must be called before resetSheets(). Returns the registry.
 */
function loadBackend() {
  const fs = require('fs');
  const path = require('path');
  const vm = require('vm');

  installMocks();
  const srcPath = path.join(__dirname, '..', 'backend', 'Code.gs');
  const src = fs.readFileSync(srcPath, 'utf8');
  vm.runInThisContext(src, { filename: srcPath });
  loaded = true;
  return registry;
}

/**
 * Convenience: load + seed with tables in one call.
 */
function loadBackendWith(tables, opts = {}) {
  loadBackend();
  return resetSheets(tables, opts);
}

function makePostRequest(payload) {
  return {
    postData: {
      contents: JSON.stringify(payload)
    }
  };
}

function doPostJson(payload) {
  const resp = doPost(makePostRequest(payload));
  return JSON.parse(resp.toString());
}

module.exports = { loadBackend, loadBackendWith, resetSheets, makePostRequest, doPostJson };
