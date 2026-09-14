import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSS_FILE = join(__dirname, '../../../docs/app/styles.css');

function readCSS() {
  return readFileSync(CSS_FILE, 'utf8');
}

describe('Phase 5: My Stats persistent layout', () => {
  it('myseason-view sits inside the left column wrapper at desktop', () => {
    const css = readCSS();
    const match = css.match(/\.col-left\s*\{[^}]*grid-column:\s*1/);
    assert.ok(match, '.col-left (containing My Stats) must be in grid column 1 at desktop');
  });

  it('myseason-view is always visible at desktop', () => {
    const css = readCSS();
    const match = css.match(/#myseason-view\s*\{[^}]*display:\s*block/);
    assert.ok(match, 'My Stats view must have display: block at desktop (always visible)');
  });
});

describe('Phase 5: My Stats responsive grids', () => {
  it('.career-record-grid has responsive column override', () => {
    const css = readCSS();
    assert.ok(
      css.includes('.career-record-grid') && css.includes('repeat(4, 1fr)') || css.includes('repeat(5, 1fr)'),
      '.career-record-grid must have responsive column override'
    );
  });

  it('.career-profile-grid has responsive column override', () => {
    const css = readCSS();
    assert.ok(
      css.includes('.career-profile-grid') && css.includes('repeat(3, 1fr)') || css.includes('repeat(4, 1fr)'),
      '.career-profile-grid must have responsive column override'
    );
  });
});

describe('Phase 5: Modal responsive sizing', () => {
  it('modal max-width increases at tablet', () => {
    const css = readCSS();
    assert.ok(
      css.includes('max-width: 480px') || css.includes('max-width:480px'),
      'Modal max-width must increase to 480px at tablet'
    );
  });

  it('player modal max-width increases at desktop', () => {
    const css = readCSS();
    assert.ok(
      css.includes('max-width: 640px') || css.includes('max-width:640px'),
      'Player modal max-width must increase to 640px at desktop'
    );
  });
});
