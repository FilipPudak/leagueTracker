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

describe('Phase 3: Tablet portrait navigation', () => {
  it('nav-tabs positioned at bottom on tablet portrait', () => {
    const css = readCSS();
    assert.ok(
      css.includes('position: fixed') && css.includes('bottom: 0'),
      'Tablet portrait must position nav-tabs at bottom'
    );
  });

  it('has safe-area-inset-bottom for iOS', () => {
    const css = readCSS();
    assert.ok(
      css.includes('env(safe-area-inset-bottom'),
      'Must use env(safe-area-inset-bottom) for iOS home indicator'
    );
  });

  it('app-container has bottom padding to avoid tab overlap', () => {
    const css = readCSS();
    assert.ok(
      css.includes('padding-bottom: 80px'),
      'app-container must have padding-bottom for fixed tabs'
    );
  });
});

describe('Phase 3: Desktop navigation', () => {
  it('has .nav-tabs-minimal class for 3-tab desktop nav', () => {
    const css = readCSS();
    assert.ok(css.includes('.nav-tabs-minimal'), 'Must have .nav-tabs-minimal class');
  });

  it('.nav-tabs-minimal has display:flex', () => {
    const css = readCSS();
    const match = css.match(/\.nav-tabs-minimal\s*\{[^}]*display:\s*flex/);
    assert.ok(match, '.nav-tabs-minimal must have display: flex');
  });

  it('main .nav-tabs is hidden at desktop breakpoint', () => {
    const css = readCSS();
    assert.ok(
      css.includes('.nav-tabs { display: none; }') || css.includes('.nav-tabs{display:none;}') || css.includes('.nav-tabs { display: none }'),
      'Main .nav-tabs must be hidden at desktop'
    );
  });
});
