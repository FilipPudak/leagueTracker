import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_DIR = join(__dirname, '../../../docs/app');
const CSS_FILE = join(APP_DIR, 'styles.css');
const HTML_FILE = join(APP_DIR, 'index.html');

function readCSS() {
  return readFileSync(CSS_FILE, 'utf8');
}

function readHTML() {
  return readFileSync(HTML_FILE, 'utf8');
}

describe('Phase 1: CSS extraction', () => {
  it('styles.css exists', () => {
    assert.ok(existsSync(CSS_FILE), 'styles.css must exist');
  });

  it('index.html links to styles.css', () => {
    const html = readHTML();
    assert.ok(
      html.includes('href="styles.css') || html.includes("href='styles.css"),
      'index.html must have a <link> to styles.css (optional ?v= stamp allowed)'
    );
  });

  it('index.html does not contain an inline <style> block', () => {
    const html = readHTML();
    assert.ok(
      !html.includes('<style>'),
      'index.html must not contain an inline <style> block (CSS should be in styles.css)'
    );
  });

  it('styles.css defines CSS custom properties', () => {
    const css = readCSS();
    assert.ok(css.includes(':root'), 'styles.css must define :root');
    assert.ok(css.includes('--container-max'), 'Must define --container-max');
    assert.ok(css.includes('--touch-target-min'), 'Must define --touch-target-min');
  });
});

describe('Phase 1: Touch target fixes', () => {
  it('.btn-ghost has min-height >= 44px', () => {
    const css = readCSS();
    const varMatch = css.match(/\.btn-ghost\s*\{[^}]*min-height:\s*var\(--touch-target-min\)/);
    const pxMatch = css.match(/\.btn-ghost\s*\{[^}]*min-height:\s*([\d.]+)px/);
    assert.ok(varMatch || pxMatch, '.btn-ghost must have min-height');
    if (pxMatch) {
      assert.ok(parseFloat(pxMatch[1]) >= 44, `.btn-ghost min-height must be >= 44px, got ${pxMatch[1]}px`);
    }
  });

  it('.btn-danger has min-height >= 44px', () => {
    const css = readCSS();
    const varMatch = css.match(/\.btn-danger\s*\{[^}]*min-height:\s*var\(--touch-target-min\)/);
    const pxMatch = css.match(/\.btn-danger\s*\{[^}]*min-height:\s*([\d.]+)px/);
    assert.ok(varMatch || pxMatch, '.btn-danger must have min-height');
    if (pxMatch) {
      assert.ok(parseFloat(pxMatch[1]) >= 44, `.btn-danger min-height must be >= 44px, got ${pxMatch[1]}px`);
    }
  });

  it('.career-tab has sufficient padding for touch targets', () => {
    const css = readCSS();
    const match = css.match(/\.career-tab\s*\{[^}]*padding:\s*([\d.]+)px\s+([\d.]+)(?:px)?/);
    assert.ok(match, '.career-tab must have padding defined');
    const paddingTop = parseFloat(match[1]);
    assert.ok(paddingTop >= 10, `.career-tab padding-top must be >= 10px for touch targets, got ${paddingTop}px`);
  });

  it('.profile-tab has sufficient padding for touch targets', () => {
    const css = readCSS();
    const match = css.match(/\.profile-tab\s*\{[^}]*padding:\s*([\d.]+)px\s+([\d.]+)(?:px)?/);
    assert.ok(match, '.profile-tab must have padding defined');
    const paddingTop = parseFloat(match[1]);
    assert.ok(paddingTop >= 10, `.profile-tab padding-top must be >= 10px for touch targets, got ${paddingTop}px`);
  });
});

describe('Phase 1: Accessibility improvements', () => {
  it('has focus-visible styles', () => {
    const css = readCSS();
    assert.ok(css.includes(':focus-visible'), 'styles.css must include :focus-visible rules');
  });

  it('has prefers-reduced-motion support', () => {
    const css = readCSS();
    assert.ok(css.includes('prefers-reduced-motion'), 'styles.css must include prefers-reduced-motion');
  });

  it('has hover media query for touch device handling', () => {
    const css = readCSS();
    assert.ok(css.includes('(hover: hover)'), 'styles.css must include @media (hover: hover)');
  });
});
