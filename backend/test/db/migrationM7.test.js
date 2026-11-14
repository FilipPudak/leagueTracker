import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSource } from '../helpers/read-source.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const M7 = readSource(join(__dirname, '../../migrations/M7.sql'));
const SCHEMA = readSource(join(__dirname, '../../schema.sql'));

describe('M7 migration', () => {
  it('adds players.melee_guid to a database that predates the column', () => {
    assert.match(M7, /ALTER TABLE players ADD COLUMN melee_guid TEXT;/);
  });

  it('does nothing else', () => {
    const statements = M7.split(';')
      .map(s => s.replace(/--[^\n]*$/gm, '').trim())
      .filter(Boolean);
    assert.equal(statements.length, 1);
  });

  it('is mirrored by schema.sql so a fresh database matches the migrated one', () => {
    const playersBlock = SCHEMA.slice(SCHEMA.indexOf('CREATE TABLE IF NOT EXISTS players'));
    assert.ok(playersBlock.includes('melee_guid'), 'schema.sql must declare players.melee_guid');
  });
});
