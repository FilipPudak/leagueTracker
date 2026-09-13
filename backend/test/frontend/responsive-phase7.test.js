import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_DIR = join(__dirname, '../../../docs/app');
const JS_FILE = join(APP_DIR, 'app.js');
const CSS_FILE = join(APP_DIR, 'styles.css');

function readJS() {
  return readFileSync(JS_FILE, 'utf8');
}

function readCSS() {
  return readFileSync(CSS_FILE, 'utf8');
}

describe('Phase 7: JS inline style cleanup', () => {
  it('app.js has no inline display:grid styles', () => {
    const js = readJS();
    const matches = js.match(/style="[^"]*display:\s*grid/g);
    assert.ok(!matches || matches.length === 0, `Found ${matches ? matches.length : 0} inline display:grid styles — should use CSS classes`);
  });

  it('app.js has no inline grid-template-columns styles', () => {
    const js = readJS();
    const matches = js.match(/style="[^"]*grid-template-columns/g);
    assert.ok(!matches || matches.length === 0, `Found ${matches ? matches.length : 0} inline grid-template-columns — should use CSS classes`);
  });

  it('CSS has .career-record-grid class', () => {
    const css = readCSS();
    assert.ok(css.includes('.career-record-grid'), 'Must have .career-record-grid class');
  });

  it('CSS has .career-profile-grid class', () => {
    const css = readCSS();
    assert.ok(css.includes('.career-profile-grid'), 'Must have .career-profile-grid class');
  });

  it('CSS has .player-modal-stats class', () => {
    const css = readCSS();
    assert.ok(css.includes('.player-modal-stats'), 'Must have .player-modal-stats class');
  });
});
