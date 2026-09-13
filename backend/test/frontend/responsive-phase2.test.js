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

describe('Phase 2: Responsive breakpoints', () => {
  it('has tablet breakpoint at 768px', () => {
    const css = readCSS();
    assert.ok(css.includes('(min-width: 768px)'), 'Must have @media (min-width: 768px) breakpoint');
  });

  it('has desktop breakpoint at 1024px', () => {
    const css = readCSS();
    assert.ok(css.includes('(min-width: 1024px)'), 'Must have @media (min-width: 1024px) breakpoint');
  });

  it('container max-width increases at tablet breakpoint', () => {
    const css = readCSS();
    const tabletMatch = css.match(/@media\s*\(min-width:\s*768px\)\s*\{[^}]*--container-max:\s*(\d+)px/);
    assert.ok(tabletMatch, 'Tablet breakpoint must set --container-max');
    assert.ok(parseInt(tabletMatch[1]) > 520, `Tablet --container-max must be > 520px, got ${tabletMatch[1]}px`);
  });

  it('container max-width increases at desktop breakpoint', () => {
    const css = readCSS();
    const desktopMatch = css.match(/@media\s*\(min-width:\s*1024px\)\s*\{[^}]*--container-max:\s*(\d+)px/);
    assert.ok(desktopMatch, 'Desktop breakpoint must set --container-max');
    assert.ok(parseInt(desktopMatch[1]) > 680, `Desktop --container-max must be > 680px, got ${desktopMatch[1]}px`);
  });

  it('container padding increases at tablet breakpoint', () => {
    const css = readCSS();
    const tabletMatch = css.match(/@media\s*\(min-width:\s*768px\)\s*\{[^}]*--container-padding:\s*(\d+)px/);
    assert.ok(tabletMatch, 'Tablet breakpoint must set --container-padding');
    assert.ok(parseInt(tabletMatch[1]) >= 32, `Tablet --container-padding must be >= 32px, got ${tabletMatch[1]}px`);
  });

  it('container padding increases at desktop breakpoint', () => {
    const css = readCSS();
    const desktopMatch = css.match(/@media\s*\(min-width:\s*1024px\)\s*\{[^}]*--container-padding:\s*(\d+)px/);
    assert.ok(desktopMatch, 'Desktop breakpoint must set --container-padding');
    assert.ok(parseInt(desktopMatch[1]) >= 40, `Desktop --container-padding must be >= 40px, got ${desktopMatch[1]}px`);
  });
});

describe('Phase 2: Responsive typography', () => {
  it('title font-size increases at tablet', () => {
    const css = readCSS();
    const tabletMatch = css.match(/@media\s*\(min-width:\s*768px\)\s*\{[^}]*--font-size-title:\s*([\d.]+)rem/);
    assert.ok(tabletMatch, 'Tablet must set --font-size-title');
    assert.ok(parseFloat(tabletMatch[1]) > 1.35, `Tablet title must be > 1.35rem, got ${tabletMatch[1]}rem`);
  });

  it('title font-size uses clamp at desktop', () => {
    const css = readCSS();
    assert.ok(css.includes('clamp(1.5rem, 2vw, 1.75rem)'), 'Desktop title must use clamp() for fluid typography');
  });
});
