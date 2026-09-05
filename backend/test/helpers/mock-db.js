// Pattern-matching D1 mock factory for testing Cloudflare Worker handlers.
// Maintains in-memory tables and responds to the prepare/bind/all/first/run chain.

export function createMockDb(tables = {}) {
  // Deep-clone seed data so tests can't corrupt shared state
  const store = {};
  for (const [table, rows] of Object.entries(tables)) {
    store[table] = (rows || []).map(r => ({ ...r }));
  }

  const calls = []; // track all queries for assertion

  function prepare(sql) {
    return new Statement(sql);
  }

  class Statement {
    constructor(sql, boundParams = []) {
      this._sql = sql;
      this._params = boundParams;
    }

    bind(...params) {
      return new Statement(this._sql, params);
    }

    async all() {
      calls.push({ sql: this._sql, params: [...this._params] });
      const { table, rows } = executeSelect(this._sql, this._params, store);
      return { results: rows, success: true };
    }

    async first() {
      calls.push({ sql: this._sql, params: [...this._params] });
      const { rows } = executeSelect(this._sql, this._params, store);
      return rows.length > 0 ? rows[0] : undefined;
    }

    async run() {
      calls.push({ sql: this._sql, params: [...this._params] });
      const upper = this._sql.toUpperCase().trim();

      if (upper.startsWith('INSERT')) {
        return executeInsert(this._sql, this._params, store);
      }
      if (upper.startsWith('UPDATE')) {
        return executeUpdate(this._sql, this._params, store);
      }
      if (upper.startsWith('DELETE')) {
        return executeDelete(this._sql, this._params, store);
      }
      if (upper.startsWith('INSERT OR REPLACE') || upper.startsWith('INSERT OR IGNORE')) {
        return executeInsert(this._sql, this._params, store);
      }
      return { success: true, changes: 0 };
    }
  }

  function getStore() { return store; }
  function getCalls() { return calls; }
  function clearCalls() { calls.length = 0; }

  return { prepare, getStore, getCalls, clearCalls };
}

// --- SQL execution helpers ---

function extractTableName(sql) {
  const upper = sql.toUpperCase();
  // INSERT INTO table / SELECT ... FROM table / UPDATE table / DELETE FROM table
  let m = sql.match(/INSERT\s+(?:OR\s+(?:REPLACE|IGNORE)\s+)?INTO\s+(\w+)/i);
  if (m) return m[1];
  m = sql.match(/FROM\s+(\w+)/i);
  if (m) return m[1];
  m = sql.match(/UPDATE\s+(\w+)/i);
  if (m) return m[1];
  m = sql.match(/DELETE\s+FROM\s+(\w+)/i);
  if (m) return m[1];
  return null;
}

function extractWhere(sql) {
  const m = sql.match(/WHERE\s+(.+?)(?:\s+ORDER\s+|\s+GROUP\s+|\s+LIMIT\s+|$)/is);
  return m ? m[1].trim() : null;
}

function extractOrderBy(sql) {
  const m = sql.match(/ORDER\s+BY\s+([\w."]+\s*(?:ASC|DESC)?(?:\s*,\s*[\w."]+\s*(?:ASC|DESC)?)*)/i);
  return m ? m[1].trim() : null;
}

function extractLimit(sql) {
  const m = sql.match(/LIMIT\s+(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
}

function matchWhere(row, whereClause, params) {
  if (!whereClause) return true;

  // Split on AND (simple case — no OR/NOT/etc.)
  const conditions = whereClause.split(/\s+AND\s+/i);

  let paramIdx = 0;
  for (const cond of conditions) {
    const trimmed = cond.trim();

    // Handle: column IS NULL
    const isNullMatch = trimmed.match(/^(\w+(?:\.\w+)?)\s+IS\s+NULL$/i);
    if (isNullMatch) {
      const col = isNullMatch[1].split('.').pop().replace(/"/g, '');
      if (row[col] != null) return false;
      continue;
    }

    // Handle: column IS NOT NULL
    const isNotNullMatch = trimmed.match(/^(\w+(?:\.\w+)?)\s+IS\s+NOT\s+NULL$/i);
    if (isNotNullMatch) {
      const col = isNotNullMatch[1].split('.').pop().replace(/"/g, '');
      if (row[col] == null) return false;
      continue;
    }

    // Handle: column = ? or column = 'literal' or column = bareValue
    const eqMatch = trimmed.match(/^(\w+(?:\.\w+)?)\s*=\s*(?:'([^']*)'|\?|(\S+))/i);
    if (eqMatch) {
      const col = eqMatch[1].split('.').pop().replace(/"/g, '');
      let val;
      if (eqMatch[2] !== undefined) {
        val = eqMatch[2];
      } else if (eqMatch[3] !== undefined) {
        val = eqMatch[3];
      } else {
        val = params[paramIdx++];
      }
      if (String(row[col]) !== String(val)) return false;
      continue;
    }

    // Handle: column != ? or column <> ?
    const neqMatch = trimmed.match(/^(\w+(?:\.\w+)?)\s*(?:!=|<>)\s*(?:'([^']*)'|\?|(\S+))/i);
    if (neqMatch) {
      const col = neqMatch[1].split('.').pop().replace(/"/g, '');
      let val;
      if (neqMatch[2] !== undefined) {
        val = neqMatch[2];
      } else if (neqMatch[3] !== undefined) {
        val = neqMatch[3];
      } else {
        val = params[paramIdx++];
      }
      if (String(row[col]) === String(val)) return false;
      continue;
    }

    // Handle: LOWER(column) = LOWER(?)
    const lowerMatch = trimmed.match(/^LOWER\((\w+(?:\.\w+)?)\)\s*=\s*LOWER\((?:'([^']*)'|\?)\)/i);
    if (lowerMatch) {
      const col = lowerMatch[1].split('.').pop().replace(/"/g, '');
      const val = lowerMatch[2] !== undefined ? lowerMatch[2] : params[paramIdx++];
      if (String(row[col] || '').toLowerCase() !== String(val).toLowerCase()) return false;
      continue;
    }

    // Handle: column LIKE ? or column LIKE 'pattern'
    const likeMatch = trimmed.match(/^(\w+(?:\.\w+)?)\s+LIKE\s+(?:'([^']*)'|\?)/i);
    if (likeMatch) {
      const col = likeMatch[1].split('.').pop().replace(/"/g, '');
      const pattern = likeMatch[2] !== undefined ? likeMatch[2] : params[paramIdx++];
      const regex = new RegExp('^' + pattern.replace(/%/g, '.*').replace(/_/g, '.') + '$', 'i');
      if (!regex.test(String(row[col] || ''))) return false;
      continue;
    }

    // Handle: column >= ? and column <= ? (for date comparisons)
    const gteMatch = trimmed.match(/^(\w+(?:\.\w+)?)\s*>=\s*(?:'([^']*)'|\?)/i);
    if (gteMatch) {
      const col = gteMatch[1].split('.').pop().replace(/"/g, '');
      const val = gteMatch[2] !== undefined ? gteMatch[2] : params[paramIdx++];
      if (row[col] < val) return false;
      continue;
    }

    const lteMatch = trimmed.match(/^(\w+(?:\.\w+)?)\s*<=\s*(?:'([^']*)'|\?)/i);
    if (lteMatch) {
      const col = lteMatch[1].split('.').pop().replace(/"/g, '');
      const val = lteMatch[2] !== undefined ? lteMatch[2] : params[paramIdx++];
      if (row[col] > val) return false;
      continue;
    }

    // Handle: IN (...) — skip for now, assume match
  }

  return true;
}

function executeSelect(sql, params, store) {
  const table = extractTableName(sql);
  const upper = sql.toUpperCase();

  if (!table || !store[table]) {
    return { table, rows: [] };
  }

  const where = extractWhere(sql);
  let rows = store[table].filter(r => matchWhere(r, where, params));

  const hasGroupBy = /GROUP\s+BY/i.test(sql);
  const hasCount = upper.includes('COUNT(');
  const hasMax = upper.includes('MAX(');

  // Handle GROUP BY (must be checked before standalone COUNT)
  if (hasGroupBy) {
    const groupMatch = sql.match(/GROUP\s+BY\s+([\w.",\s]+)/i);
    const groupCols = groupMatch[1].split(',').map(c => c.trim().split('.').pop().replace(/"/g, '').toLowerCase());
    const groups = new Map();
    for (const row of store[table].filter(r => matchWhere(r, where, params))) {
      const key = groupCols.map(c => row[c]).join('||');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }

    rows = [];
    for (const [, groupRows] of groups) {
      if (upper.includes('COUNT(DISTINCT')) {
        const distMatch = upper.match(/COUNT\(DISTINCT\s+(\w+(?:\.\w+)?)\)/i);
        const aliasMatch = upper.match(/AS\s+(\w+)/i);
        const col = distMatch[1].split('.').pop().replace(/"/g, '');
        const alias = aliasMatch ? aliasMatch[1].toLowerCase() : 'count';
        const uniqueVals = new Set(groupRows.map(r => r[col]));
        const row = {};
        for (const gc of groupCols) {
          row[gc] = groupRows[0][gc];
        }
        row[alias] = uniqueVals.size;
        rows.push(row);
      } else if (hasCount) {
        const aliasMatch = upper.match(/AS\s+(\w+)/i);
        const alias = aliasMatch ? aliasMatch[1].toLowerCase() : 'count';
        const row = {};
        for (const gc of groupCols) {
          row[gc] = groupRows[0][gc];
        }
        row[alias] = groupRows.length;
        rows.push(row);
      } else {
        rows.push(groupRows[0]);
      }
    }

    // Apply ORDER BY after GROUP BY
    const orderBy = extractOrderBy(sql);
    if (orderBy) {
      const parts = orderBy.split(',').map(p => {
        const [colRaw, dir] = p.trim().split(/\s+/);
        const col = colRaw.replace(/"/g, '');
        return { col, desc: (dir || 'ASC').toUpperCase() === 'DESC' };
      });
      rows.sort((a, b) => {
        for (const { col, desc } of parts) {
          const va = a[col] ?? '', vb = b[col] ?? '';
          const cmp = String(va).localeCompare(String(vb), undefined, { numeric: true });
          if (cmp !== 0) return desc ? -cmp : cmp;
        }
        return 0;
      });
    }

    const limit = extractLimit(sql);
    if (limit) {
      rows = rows.slice(0, limit);
    }

    return { table, rows };
  }

  // Handle standalone COUNT (no GROUP BY)
  if (hasCount) {
    const countRow = { count: rows.length };

    const distinctMatch = upper.match(/COUNT\(DISTINCT\s+(\w+(?:\.\w+)?)\)/);
    if (distinctMatch) {
      const col = distinctMatch[1].split('.').pop().replace(/"/g, '');
      const uniqueVals = new Set(rows.map(r => r[col]).filter(v => v != null));
      countRow.count = uniqueVals.size;
    }

    // Handle alias: COUNT(DISTINCT col) AS alias, COUNT(*) as count, etc.
    const aliasMatch = upper.match(/COUNT\([^)]*\)\s+AS\s+(\w+)/i)
      || upper.match(/COUNT\(\*?\)?\s+AS\s+(\w+)/);
    if (aliasMatch) {
      const alias = aliasMatch[1].toLowerCase();
      return { table, rows: [{ [alias]: countRow.count }] };
    }

    return { table, rows: [{ count: countRow.count }] };
  }

  // Handle SELECT specific columns vs SELECT *
  const selectMatch = sql.match(/SELECT\s+(.+?)\s+FROM/i);
  if (selectMatch && !selectMatch[1].includes('*')) {
    const cols = selectMatch[1].split(',').map(c => {
      const parts = c.trim().split(/\s+AS\s+/i);
      return { name: parts[0].trim().split('.').pop().replace(/"/g, ''), alias: parts[1]?.trim().toLowerCase() };
    });
    rows = rows.map(r => {
      const out = {};
      for (const col of cols) {
        out[col.alias || col.name] = r[col.name];
      }
      return out;
    });
  }

  // Handle ORDER BY
  const orderBy = extractOrderBy(sql);
  if (orderBy) {
    const parts = orderBy.split(',').map(p => {
      const [colRaw, dir] = p.trim().split(/\s+/);
      const col = colRaw.replace(/"/g, '');
      return { col, desc: (dir || 'ASC').toUpperCase() === 'DESC' };
    });
    rows.sort((a, b) => {
      for (const { col, desc } of parts) {
        const va = a[col] ?? '', vb = b[col] ?? '';
        const cmp = String(va).localeCompare(String(vb), undefined, { numeric: true });
        if (cmp !== 0) return desc ? -cmp : cmp;
      }
      return 0;
    });
  }

  // Handle MAX()
  if (hasMax) {
    const maxMatch = upper.match(/MAX\((\w+(?:\.\w+)?)\)/);
    if (maxMatch) {
      const col = maxMatch[1].split('.').pop().replace(/"/g, '');
      const aliasMatch = upper.match(/AS\s+(\w+)/i);
      const alias = aliasMatch ? aliasMatch[1].toLowerCase() : 'max_id';
      const maxVal = rows.reduce((m, r) => {
        const v = typeof r[col] === 'string' ? parseInt(r[col].replace(/\D/g, ''), 10) : r[col];
        return v > m ? v : m;
      }, 0);
      return { table, rows: [{ [alias]: maxVal || 0 }] };
    }
  }

  // Handle LIMIT
  const limit = extractLimit(sql);
  if (limit) {
    rows = rows.slice(0, limit);
  }

  return { table, rows };
}

function executeInsert(sql, params, store) {
  const table = extractTableName(sql);
  if (!table) return { success: true, changes: 0 };

  // Extract column names from INSERT INTO table (col1, col2, ...) VALUES
  const colMatch = sql.match(/INSERT\s+(?:OR\s+(?:REPLACE|IGNORE)\s+)?INTO\s+\w+\s*\(([^)]+)\)/i);
  if (!colMatch) return { success: true, changes: 0 };

  const cols = colMatch[1].split(',').map(c => c.trim().replace(/"/g, ''));

  // Handle INSERT OR IGNORE — skip if row exists
  const isIgnore = sql.toUpperCase().includes('INSERT OR IGNORE');
  if (isIgnore) {
    // Check if row already exists (match primary key columns)
    const existing = (store[table] || []).find(r => {
      return cols.every((col, i) => String(r[col]) === String(params[i]));
    });
    if (existing) return { success: true, changes: 0 };
  }

  const row = {};
  cols.forEach((col, i) => { row[col] = params[i]; });

  if (!store[table]) store[table] = [];
  store[table].push(row);

  return { success: true, changes: 1 };
}

function executeUpdate(sql, params, store) {
  const table = extractTableName(sql);
  if (!table || !store[table]) return { success: true, changes: 0 };

  // Extract SET assignments
  const setMatch = sql.match(/SET\s+(.+?)\s+WHERE/is);
  if (!setMatch) return { success: true, changes: 0 };

  const where = extractWhere(sql);
  let paramIdx = 0;

  // Count SET params (everything before WHERE)
  const setClauses = setMatch[1].split(',').map(c => c.trim());
  const setParams = params.slice(0, setClauses.length);
  paramIdx = setClauses.length;

  // Get WHERE params
  const whereParams = where ? params.slice(paramIdx) : [];

  let changes = 0;
  for (const row of store[table]) {
    if (matchWhere(row, where, whereParams)) {
      for (const clause of setClauses) {
        const eqMatch = clause.match(/(\w+(?:\.\w+)?)\s*=\s*(?:'([^']*)'|\?)/i);
        if (eqMatch) {
          const col = eqMatch[1].split('.').pop().replace(/"/g, '');
          // Check if it's a function call like datetime('now')
          if (eqMatch[2] !== undefined) {
            row[col] = eqMatch[2];
          } else {
            row[col] = setParams[setClauses.indexOf(clause)];
          }
        }
      }
      changes++;
    }
  }

  return { success: true, changes };
}

function executeDelete(sql, params, store) {
  const table = extractTableName(sql);
  if (!table || !store[table]) return { success: true, changes: 0 };

  const where = extractWhere(sql);
  const before = store[table].length;
  store[table] = store[table].filter(r => !matchWhere(r, where, params));
  return { success: true, changes: before - store[table].length };
}
