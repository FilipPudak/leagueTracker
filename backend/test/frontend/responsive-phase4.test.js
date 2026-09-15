import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSS_FILE = join(__dirname, '../../../docs/app/styles.css');
const JS_FILE = join(__dirname, '../../../docs/app/app.js');

function readCSS() { return readFileSync(CSS_FILE, 'utf8'); }
function readJS() { return readFileSync(JS_FILE, 'utf8'); }

describe('Phase 4: Desktop 2-panel CSS Grid', () => {
  it('desktop-columns has display:grid at desktop', () => {
    const css = readCSS();
    assert.ok(
      css.match(/\.desktop-columns\s*\{[^}]*display:\s*grid/),
      '.desktop-columns must have display: grid'
    );
  });

  it('desktop-columns has 2-column grid at desktop', () => {
    const css = readCSS();
    assert.ok(
      css.match(/\.desktop-columns\s*\{[^}]*grid-template-columns/),
      '.desktop-columns must have grid-template-columns'
    );
  });

  it('col-left sits in grid-column: 1 at desktop', () => {
    const css = readCSS();
    assert.ok(
      css.match(/\.col-left\s*\{[^}]*grid-column:\s*1/),
      '.col-left must have grid-column: 1'
    );
  });
});

describe('Phase 4: boot view routing', () => {
  it('applyBoot routes linked users through the hash router', () => {
    const js = readJS();
    assert.ok(
      js.includes('normalizeBootHash()') && js.includes("switchTab('vote-view')"),
      'applyBoot must route via the hash router/switchTab so the shown view loads its data'
    );
  });

  it('desktop boot loads persistent My Stats data', () => {
    const js = readJS();
    assert.ok(
      js.includes('innerWidth >= 1024'),
      'applyBoot must detect desktop to load the persistent panel'
    );
  });
});

describe('Phase 4: Vote CTA on standings', () => {
  it('vote-cta element exists in HTML', () => {
    const html = readFileSync(join(__dirname, '../../../docs/app/index.html'), 'utf8');
    assert.ok(html.includes('vote-cta'), 'Must have #vote-cta element');
  });
});
