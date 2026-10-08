import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readSource } from '../helpers/read-source.js';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSS_FILE = join(__dirname, '../../../docs/app/styles.css');
const JS_FILE = join(__dirname, '../../../docs/app/app.js');

function readCSS() { return readSource(CSS_FILE); }
function readJS() { return readSource(JS_FILE); }

describe('Layout: desktop 2-panel CSS Grid', () => {
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

describe('Boot: view routing', () => {
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

describe('Standings: vote CTA', () => {
  it('vote-cta element exists in HTML', () => {
    const html = readSource(join(__dirname, '../../../docs/app/index.html'));
    assert.ok(html.includes('vote-cta'), 'Must have #vote-cta element');
  });
});
