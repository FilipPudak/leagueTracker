import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML_FILE = join(__dirname, '../../../docs/app/index.html');

function readHTML() {
  return readFileSync(HTML_FILE, 'utf8');
}

describe('Phase 6: Tab ARIA roles', () => {
  it('nav-tabs has role="tablist"', () => {
    const html = readHTML();
    assert.ok(html.includes('role="tablist"'), 'nav-tabs must have role="tablist"');
  });

  it('tab buttons have role="tab"', () => {
    const html = readHTML();
    const tabButtons = html.match(/class="tab-btn[^"]*"[^>]*role="tab"/g) ||
                       html.match(/role="tab"[^>]*class="tab-btn/g);
    assert.ok(tabButtons && tabButtons.length >= 4, 'All tab buttons must have role="tab"');
  });

  it('tab buttons have aria-selected attribute', () => {
    const html = readHTML();
    assert.ok(html.includes('aria-selected='), 'Tab buttons must have aria-selected attribute');
  });

  it('view panels have role="tabpanel"', () => {
    const html = readHTML();
    const panels = html.match(/role="tabpanel"/g);
    assert.ok(panels && panels.length >= 4, 'View panels must have role="tabpanel"');
  });
});

describe('Phase 6: Semantic round-header', () => {
  it('round-header uses button element or has role="button"', () => {
    const html = readHTML();
    const jsSrc = readFileSync(join(__dirname, '../../../docs/app/app.js'), 'utf8');
    const hasButton = (html.includes('<button') && html.includes('round-header')) ||
                      (jsSrc.includes('round-header') && jsSrc.includes('role="button"'));
    assert.ok(hasButton, 'round-header must be a <button> or have role="button"');
  });

  it('round-header has tabindex for keyboard access', () => {
    const html = readHTML();
    assert.ok(
      html.includes('tabindex="0"') || html.includes('<button'),
      'round-header must be keyboard accessible (tabindex or button element)'
    );
  });
});
