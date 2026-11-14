import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSource } from '../helpers/read-source.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const M6 = readSource(join(__dirname, '../../migrations/M6.sql'));
const SCHEMA = readSource(join(__dirname, '../../schema.sql'));

describe('M6 migration', () => {
  it('creates the username history table keyed on the normalized name', () => {
    assert.match(M6, /CREATE TABLE IF NOT EXISTS player_usernames/);
    assert.match(M6, /PRIMARY KEY \(player_id, name_lower\)/);
    assert.match(M6, /CREATE INDEX IF NOT EXISTS idx_player_usernames_lower ON player_usernames\(name_lower\)/);
  });

  it('creates the rename request queue', () => {
    assert.match(M6, /CREATE TABLE IF NOT EXISTS rename_requests/);
    assert.match(M6, /status\s+TEXT NOT NULL DEFAULT 'pending'/);
    for (const column of ['melee_hint', 'requested_at', 'resolved_at', 'resolved_by', 'note']) {
      assert.ok(M6.includes(column), `rename_requests must define ${column}`);
    }
    assert.match(M6, /CREATE INDEX IF NOT EXISTS idx_rename_requests_player ON rename_requests\(player_id\)/);
  });

  it('seeds every current username with an honest NULL first_seen, re-runnably', () => {
    const seed = M6.slice(M6.indexOf('INSERT OR IGNORE INTO player_usernames'));
    assert.match(seed, /SELECT id, melee_name, LOWER\(melee_name\), 'seed', NULL, strftime\('%Y-%m-%dT%H:%M:%fZ', 'now'\)/);
    assert.match(seed, /FROM players WHERE melee_name IS NOT NULL/);
  });

  it('is re-runnable: no bare INSERT and no unconditional DDL failures', () => {
    for (const statement of M6.split(';').map(s => s.trim()).filter(Boolean)) {
      if (/^(CREATE|INSERT)/i.test(statement)) {
        assert.ok(
          /IF NOT EXISTS|OR IGNORE/i.test(statement),
          `statement is not re-runnable: ${statement.split('\n')[0]}`
        );
      }
    }
  });

  it('is mirrored by schema.sql so a fresh database matches the migrated one', () => {
    for (const table of ['player_usernames', 'rename_requests']) {
      assert.ok(
        SCHEMA.includes(`CREATE TABLE IF NOT EXISTS ${table}`),
        `schema.sql must declare ${table}`
      );
    }
    assert.ok(SCHEMA.includes('idx_player_usernames_lower'), 'schema.sql must carry the history index');
    assert.ok(SCHEMA.includes('idx_rename_requests_player'), 'schema.sql must carry the queue index');
  });

  it('no UNIQUE constraint on name_lower (usernames can be recycled)', () => {
    assert.ok(!/UNIQUE[^;]*name_lower/i.test(M6), 'name_lower must not be unique');
  });
});
