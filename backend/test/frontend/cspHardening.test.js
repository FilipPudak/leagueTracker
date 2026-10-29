import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readSource } from '../helpers/read-source.js';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML = join(__dirname, '../../../docs/app/index.html');
const JS = join(__dirname, '../../../docs/app/app.js');
const BOOT = join(__dirname, '../../../docs/app/boot.js');

describe('CSP hardening Phase A: no inline event handlers', () => {
  it('index.html carries zero on*= handler attributes', () => {
    const html = readSource(HTML);
    const found = html.match(/\son(click|change|input|submit|keydown)\s*=\s*"[^"]*"/g) || [];
    assert.equal(found.length, 0, `inline handlers remain: ${found.map(s => s.trim()).join(' | ')}`);
  });

  it('app.js carries no handler strings in generated markup', () => {
    const js = readSource(JS);
    const found = js.match(/\bon(click|change|input|submit|keydown)=/g) || [];
    assert.equal(found.length, 0, `handler strings remain in templates: ${found.join(' | ')}`);
  });

  it('the pre-paint boot script is external, not inline', () => {
    const html = readSource(HTML);
    const inline = html.match(/<script(?![^>]*\bsrc=)[^>]*>/g) || [];
    assert.equal(inline.length, 0, `inline <script> blocks remain: ${inline.join(' | ')}`);
    assert.ok(html.includes('src="boot.js?v='), 'boot.js must be loaded with a cache-bust stamp');
    const boot = readSource(BOOT);
    assert.ok(boot.includes("classList.toggle('is-linked'"), 'boot keeps the pre-paint linked-state class');
    assert.ok(boot.includes('lt_token'), 'boot reads the token key');
  });

  it('wireEvents exists and runs at DOMContentLoaded', () => {
    const js = readSource(JS);
    assert.ok(/function wireEvents\(/.test(js), 'central wiring function must exist');
    const idx = js.indexOf('DOMContentLoaded');
    assert.ok(idx !== -1 && js.slice(idx, idx + 400).includes('wireEvents()'), 'wiring must run on init');
  });

  it('static handlers are wired by id with data-attribute families', () => {
    const html = readSource(HTML);
    const js = readSource(JS);
    assert.equal((html.match(/data-view=/g) || []).length, 4, 'four nav tabs carry data-view');
    assert.equal((html.match(/data-tab=/g) || []).length, 5, 'two profile + three career tabs carry data-tab');
    assert.equal((html.match(/data-season-sync=/g) || []).length, 4, 'four season selects carry data-season-sync');
    assert.ok(js.includes("on('vote-form', 'submit'") && js.includes("on('link-form', 'submit'"), 'forms must be wired via listeners');
    assert.ok(/wireBackdrop\(\$\('link-modal-overlay'\)/.test(js), 'sign-in backdrop tap closes sign-in');
    assert.ok(/wireBackdrop\(\$\('player-modal-overlay'\)/.test(js), 'player backdrop tap closes modal');
  });

  it('dynamic rows are wired by delegation on persistent containers', () => {
    const js = readSource(JS);
    assert.ok(/closest\('\[data-player-id\]'\)/.test(js), 'player rows must use delegation via data-player-id');
    assert.ok(!/\$\('link-player-select'\)\.innerHTML(?![\s\S]{0,80}addEventListener)/.test(js) || js.includes("'link-player-select'"), 'picker container must host a delegated listener');
    assert.ok(js.includes("closest('.round-header')"), 'night accordion toggles by delegation');
    assert.ok(js.includes("on('round-results-container', 'keydown'") || js.includes("addEventListener('keydown'"), 'keyboard Enter/Space toggles survive');
  });

  it('every id wired in wireEvents exists in index.html (no silent unwiring)', () => {
    const js = readSource(JS);
    const html = readSource(HTML);
    const start = js.indexOf('function wireEvents');
    const end = js.indexOf("document.addEventListener('DOMContentLoaded'");
    assert.ok(start !== -1 && end > start, 'wireEvents body must be locatable');
    const body = js.slice(start, end);
    const ids = new Set();
    for (const m of body.matchAll(/\bon\('([\w-]+)',/g)) ids.add(m[1]);
    for (const m of body.matchAll(/wireBackdrop\(\$\('([\w-]+)'\)/g)) ids.add(m[1]);
    for (const m of body.matchAll(/'([\w-]+)':\s*load[A-Z]\w+/g)) ids.add(m[1]);
    assert.ok(ids.size >= 20, `expected the full wired-id set, found ${ids.size}`);
    [...ids].forEach((id) => {
      assert.ok(html.includes(`id="${id}"`), `wireEvents targets #${id} but index.html has no such id`);
    });
  });
});
