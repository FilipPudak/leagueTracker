import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSS_FILE = join(__dirname, '../../../docs/app/styles.css');
const JS_FILE = join(__dirname, '../../../docs/app/app.js');
const HTML_FILE = join(__dirname, '../../../docs/app/index.html');

function readCSS() { return readFileSync(CSS_FILE, 'utf8'); }
function readJS() { return readFileSync(JS_FILE, 'utf8'); }
function readHTML() { return readFileSync(HTML_FILE, 'utf8'); }

describe('Shortcut fixes: Wide desktop breakpoint', () => {
  it('has 1280px media query', () => {
    const css = readCSS();
    assert.ok(
      css.includes('min-width: 1280px'),
      'Must have 1280px+ media query'
    );
  });
});

describe('Shortcut fixes: Resize listener', () => {
  it('has matchMedia listener for desktop breakpoint', () => {
    const js = readJS();
    assert.ok(
      js.includes('matchMedia') && js.includes('1024'),
      'Must have matchMedia listener for 1024px breakpoint'
    );
  });

  it('resize listener calls setActiveView or re-renders tabs', () => {
    const js = readJS();
    assert.ok(
      js.includes('matchMedia') && (js.includes('setActiveView') || js.includes('switchTab')),
      'Resize listener must trigger layout update'
    );
  });
});

describe('Shortcut fixes: Vote-cta hide after vote', () => {
  it('vote-cta is hidden after vote submission', () => {
    const js = readJS();
    assert.ok(
      js.includes('vote-cta') && js.includes('display') && js.includes('none'),
      'vote-cta must be hidden after vote submission'
    );
  });
});

describe('Shortcut fixes: My Stats tab hidden on desktop', () => {
  it('myseason tab has display:none on desktop (persistent panel)', () => {
    const css = readCSS();
    const match = css.match(/\.nav-tabs\s+\.tab-btn\[aria-controls="myseason-view"\]\s*\{[^}]*display:\s*none/);
    assert.ok(match, 'My Stats tab must have display:none on desktop');
  });
});

describe('Shortcut fixes: Remove dead tabIndex param', () => {
  it('setActiveView does not use tabIndex parameter for tab matching', () => {
    const js = readJS();
    const match = js.match(/function setActiveView\(viewId/);
    assert.ok(match, 'setActiveView must exist');
    assert.ok(
      !js.includes('function setActiveView(viewId, tabIndex)'),
      'setActiveView must not have tabIndex parameter'
    );
  });

  it('switchTab calls setActiveView without tabIndex', () => {
    const js = readJS();
    const calls = js.match(/setActiveView\('[^']+'\)/g);
    assert.ok(calls && calls.length > 0, 'setActiveView must be called without tabIndex');
  });
});
