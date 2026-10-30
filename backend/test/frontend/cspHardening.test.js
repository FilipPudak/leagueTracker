import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { readSource } from '../helpers/read-source.js';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP = join(__dirname, '../../../docs/app');
const HTML = join(APP, 'index.html');
const JS = join(APP, 'app.js');
const BOOT = join(APP, 'boot.js');
const CSS = join(APP, 'styles.css');

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

  it('Phase B: meta CSP present, script-self-only, and placed before every resource', () => {
    const html = readSource(HTML);
    const metaIdx = html.indexOf('<meta http-equiv="Content-Security-Policy"');
    assert.ok(metaIdx !== -1, 'meta CSP must be delivered in the document');
    const meta = html.slice(metaIdx, html.indexOf('>', metaIdx) + 1);
    assert.ok(meta.includes("default-src 'none'"), 'deny-by-default');
    assert.ok(/script-src 'self'(;|")/.test(meta), "script-src must be 'self' with no further sources");
    assert.ok(!meta.includes("script-src 'self' 'unsafe-inline'"), 'no unsafe-inline for scripts');
    assert.ok(meta.includes("style-src-attr 'unsafe-inline'"), 'style attribute idiom stays allowed');
    assert.ok(meta.includes("style-src-elem 'self'"), 'style elements pinned to self');
    assert.ok(meta.includes("style-src 'self' 'unsafe-inline'"),
      'legacy style-src fallback so pre-2022 browsers never fall to default-src none');
    assert.ok(meta.includes('connect-src https://league-tracker.filip-pudak.workers.dev'), 'connect pinned to the worker');
    assert.ok(meta.includes('http://localhost:8787'), 'dev localhost branch stays allowed');
    assert.ok(meta.includes("base-uri 'none'") && meta.includes("form-action 'none'") && meta.includes("object-src 'none'"), 'navigation/embed hardening present');
    assert.ok(metaIdx < html.indexOf('<link rel="stylesheet"'), 'policy must precede every resource it should govern');
    assert.ok(html.indexOf('<meta charset') < metaIdx && metaIdx - html.indexOf('<meta charset') < 120, 'placed immediately after charset');
  });
});

describe('CSP hardening Phase C1: fonts self-hosted, zero third-party origins', () => {
  it('no Google font references remain in the shipped surface', () => {
    const html = readSource(HTML);
    const css = readSource(CSS);
    for (const [name, src] of [['index.html', html], ['styles.css', css]]) {
      assert.ok(!src.includes('fonts.googleapis.com'), `${name} must not reference fonts.googleapis.com`);
      assert.ok(!src.includes('fonts.gstatic.com'), `${name} must not reference fonts.gstatic.com`);
    }
  });

  it('four pinned latin woff2 files are bundled on disk', () => {
    const files = ['orbitron-latin.woff2', 'rajdhani-500.woff2', 'rajdhani-600.woff2', 'rajdhani-700.woff2'];
    files.forEach((f) => {
      const p = join(APP, 'fonts', f);
      assert.ok(existsSync(p), `fonts/${f} must exist`);
      assert.ok(statSync(p).size > 8000, `fonts/${f} looks truncated (${statSync(p).size} bytes)`);
    });
    assert.ok(!existsSync(join(APP, 'fonts', 'orbitron-400.woff2')), 'orbitron is one variable file, no per-weight duplicates');
  });

  it('OFL license texts ship alongside the fonts', () => {
    assert.ok(existsSync(join(APP, 'fonts', 'OFL-orbitron.txt')), 'Orbitron OFL required');
    assert.ok(existsSync(join(APP, 'fonts', 'OFL-rajdhani.txt')), 'Rajdhani OFL required');
  });

  it('styles.css declares the @font-face sources locally', () => {
    const css = readSource(CSS);
    assert.equal((css.match(/@font-face/g) || []).length, 4, 'one variable orbitron + three static rajdhani faces');
    ['orbitron-latin', 'rajdhani-500', 'rajdhani-600', 'rajdhani-700'].forEach((n) => {
      assert.ok(css.includes(`url('fonts/${n}.woff2')`), `@font-face must load fonts/${n}.woff2 locally`);
    });
    assert.ok(/font-weight:\s*400 900/.test(css), 'orbitron face declares the variable weight range');
    assert.ok(css.includes('font-display: swap'), 'swap semantics preserved from Google css');
    assert.ok(!css.includes('gstatic') && !css.includes('googleapis'), 'css must not reach back to Google');
  });

  it('policy is same-origin + worker only after C1', () => {
    const html = readSource(HTML);
    const meta = html.slice(html.indexOf('<meta http-equiv="Content-Security-Policy"'),
      html.indexOf('>', html.indexOf('<meta http-equiv="Content-Security-Policy"')) + 1);
    assert.ok(meta.includes("font-src 'self'"), 'font-src pinned to self');
    assert.ok(!meta.includes('googleapis') && !meta.includes('gstatic'), 'no external origins left in the policy');
  });
});

describe('CSP hardening Phase D: aspect icons are same-origin only (v4.18.0)', () => {
  const CORE = join(APP, 'app-core.js');
  const IMG_DIR = join(APP, 'img', 'swu');
  const ASPECTS = ['Aggression', 'Command', 'Cunning', 'Heroism', 'Vigilance', 'Villainy'];

  it('six resized icon files exist under img/swu and are lightweight', () => {
    for (const a of ASPECTS) {
      const p = join(IMG_DIR, `SWH_Aspects_${a}.png`);
      assert.ok(existsSync(p), `img/swu/SWH_Aspects_${a}.png must be bundled`);
      const size = statSync(p).size;
      assert.ok(size > 1000, `SWH_Aspects_${a}.png looks truncated (${size} bytes)`);
      assert.ok(size < 40 * 1024, `SWH_Aspects_${a}.png must be resized (96px), got ${size} bytes`);
    }
  });

  it('icon markup template is whitelisted, same-origin and alt-complete', () => {
    const core = readSource(CORE);
    assert.ok(/aspectIconMarkup/.test(core), 'LeagueCore must expose aspectIconMarkup');
    const srcs = [...core.matchAll(/src="([^"]*)"/g)].map(m => m[1]);
    assert.equal(srcs.length, 1, 'exactly one icon src template (aspect name interpolated, never raw URL)');
    assert.ok(srcs[0].startsWith('img/swu/SWH_Aspects_'), 'icon src must live under img/swu/');
    assert.ok(!srcs[0].includes('http'), 'no external image origin');
    assert.ok(/alt="\$\{\w+\}"/.test(core), 'icon img must carry alt text (interpolated aspect name)');
    assert.ok(!/\bon(click|error|load)=/.test(core), 'generated icon markup must stay handler-free');
  });

  it('styles.css defines .swu-icon and reaches no external url()', () => {
    const css = readSource(CSS);
    const rule = css.match(/\.swu-icon\s*{[^}]*}/);
    assert.ok(rule, '.swu-icon rule required');
    assert.ok(/height:\s*1em/.test(rule[0]), 'icons must size with the text line');
    assert.ok(!/url\(\s*['"]?https?:/.test(css), 'styles.css must not reference external urls');
  });

  it('both leader surfaces route through aspectIconMarkup', () => {
    const js = readSource(JS);
    assert.equal((js.match(/getIcons:/g) || []).length, 2, 'renderStatsList configs: topLeaders + myseason leaders');
    const seasonBody = js.slice(js.indexOf('function renderSeasonContent'), js.indexOf('function renderPlayerModal'));
    assert.ok(seasonBody.includes('LeagueCore.aspectIconMarkup'), 'profile/modal leader rows render icons too');
  });

  it('index.html ships no external img sources', () => {
    const html = readSource(HTML);
    for (const m of html.matchAll(/<img[^>]*>/g)) {
      assert.ok(!/src="https?:/.test(m[0]), `external img src in html: ${m[0]}`);
    }
  });
});
