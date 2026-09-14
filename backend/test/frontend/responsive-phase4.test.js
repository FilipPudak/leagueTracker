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
  it('app-container has display:grid at desktop', () => {
    const css = readCSS();
    assert.ok(
      css.includes('.app-container') && css.includes('display: grid'),
      '.app-container must have display: grid'
    );
  });

  it('app-container has 2-column grid at desktop', () => {
    const css = readCSS();
    assert.ok(
      css.includes('.app-container') && css.includes('grid-template-columns'),
      '.app-container must have grid-template-columns'
    );
  });

  it('myseason-view has grid-column: 1 at desktop (persistent left panel)', () => {
    const css = readCSS();
    const match = css.match(/#myseason-view\s*\{[^}]*grid-column:\s*1/);
    assert.ok(match, '#myseason-view must have grid-column: 1');
  });
});

describe('Phase 4: boot view routing', () => {
  it('applyBoot routes linked users through switchTab', () => {
    const js = readJS();
    assert.ok(
      js.includes("switchTab('standings-view')") && js.includes("switchTab('vote-view')"),
      'applyBoot must route via switchTab so the shown view loads its data'
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
