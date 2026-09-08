import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HANDLERS_DIR = join(__dirname, '../../src/handlers');
const LIB_DIR = join(__dirname, '../../src/lib');

function getAllJsFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getAllJsFiles(fullPath));
    } else if (entry.name.endsWith('.js')) {
      files.push(fullPath);
    }
  }
  return files;
}

function readFiles(dir) {
  const files = getAllJsFiles(dir);
  return files.map(f => ({
    path: f,
    content: readFileSync(f, 'utf-8'),
  }));
}

describe('Privacy guard: no voter+opponent leak', () => {
  it('no handler returns opponent_id alongside voter identity in the same response', () => {
    const handlers = readFiles(HANDLERS_DIR);
    const violations = [];

    for (const file of handlers) {
      const lines = file.content.split('\n');
      let hasVoterJoin = false;
      let hasOpponentInResponse = false;

      for (const line of lines) {
        const lower = line.toLowerCase();
        if (lower.includes('votes') && lower.includes('player_id')) {
          hasVoterJoin = true;
        }
        if (lower.includes('opponent_id') && (lower.includes('return') || lower.includes('response') || lower.includes('data'))) {
          hasOpponentInResponse = true;
        }
      }

      if (hasVoterJoin && hasOpponentInResponse) {
        violations.push(file.path);
      }
    }

    assert.deepEqual(violations, [], 'Found handlers that may leak voter+opponent identity');
  });

  it('getAppData does not expose opponent_id in voter-voter mapping', () => {
    const file = readFileSync(join(HANDLERS_DIR, 'getAppData.js'), 'utf-8');
    const lines = file.split('\n');
    const suspect = lines.filter(l =>
      l.includes('opponent_id') && !l.includes('//') && !l.includes('opponentIds')
    );
    assert.equal(suspect.length, 0, 'getAppData should not expose opponent_id in responses');
  });
});
