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
  it('.nav-tabs is visible at desktop (flex layout)', () => {
    const css = readCSS();
    const match = css.match(/\.nav-tabs\s*\{\s*display:\s*flex/);
    assert.ok(match, '.nav-tabs base rule must be display: flex');
  });

  it('My Stats tab is hidden at desktop, others remain', () => {
    const css = readCSS();
    const desktopBlock = css.match(/\/\* Desktop \(1024px\+\) \*\/[\s\S]*?\n\}\n/);
    assert.ok(desktopBlock, 'Desktop media query must exist');
    assert.ok(
      desktopBlock[0].includes('.nav-tabs .tab-btn[aria-controls="myseason-view"]'),
      'Desktop must target the My Stats tab'
    );
    assert.ok(!/\.nav-tabs\s*\{\s*display:\s*none/.test(desktopBlock[0]), '.nav-tabs itself must not be hidden at desktop');
  });
});
