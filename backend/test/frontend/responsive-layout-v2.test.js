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

describe('Layout v2: Identity chip scoped to vote tab', () => {
  it('identity-chip is inside vote-view', () => {
    const html = readHTML();
    const chipIdx = html.indexOf('id="identity-chip"');
    const voteIdx = html.indexOf('id="vote-view"');
    const voteEnd = html.indexOf('<!-- STANDINGS PANEL -->');
    assert.ok(chipIdx > voteIdx && chipIdx < voteEnd, 'identity-chip must be inside #vote-view');
  });

  it('identity-chip is NOT inside header', () => {
    const html = readHTML();
    const headerStart = html.indexOf('class="header"');
    const headerEnd = html.indexOf('</div>', headerStart + 100);
    const chipIdx = html.indexOf('id="identity-chip"');
    assert.ok(chipIdx < headerStart || chipIdx > headerEnd, 'identity-chip must not be inside .header');
  });
});

describe('Layout v2: Desktop 2-panel reversed', () => {
  it('myseason-view has grid-column: 1 at desktop', () => {
    const css = readCSS();
    const match = css.match(/#myseason-view\s*\{[^}]*grid-column:\s*1/);
    assert.ok(match, '#myseason-view must be grid-column: 1 at desktop');
  });

  it('vote-view, standings-view, leaderboard-view have grid-column: 2', () => {
    const css = readCSS();
    assert.ok(css.match(/#vote-view[\s\S]*?grid-column:\s*2/), '#vote-view must be grid-column: 2');
    assert.ok(css.match(/#standings-view[\s\S]*?grid-column:\s*2/), '#standings-view must be grid-column: 2');
    assert.ok(css.match(/#leaderboard-view[\s\S]*?grid-column:\s*2/), '#leaderboard-view must be grid-column: 2');
  });

  it('My Stats tab hidden from nav-tabs-minimal', () => {
    const css = readCSS();
    const match = css.match(/#nav-tabs-minimal[^}]*aria-controls="myseason-view"[^}]*display:\s*none/);
    const match2 = css.match(/\.nav-tabs-minimal\s+\.tab-btn\[aria-controls="myseason-view"\]\s*\{[^}]*display:\s*none/);
    assert.ok(match || match2, 'My Stats tab must have display:none in nav-tabs-minimal');
  });
});

describe('Layout v2: showTabs respects desktop', () => {
  it('showTabs checks innerWidth >= 1024', () => {
    const js = readJS();
    assert.ok(
      js.includes('innerWidth >= 1024') || js.includes('innerWidth>=1024'),
      'showTabs must check window.innerWidth >= 1024'
    );
  });
});

describe('Layout v2: Default view logic', () => {
  it('standings is default for linked users (not vote)', () => {
    const js = readJS();
    assert.ok(
      js.includes("setActiveView('standings-view')"),
      'applyBoot must call setActiveView with standings-view'
    );
    assert.ok(
      js.includes("localStorage.getItem('firstLogin')"),
      'applyBoot must check firstLogin before choosing view'
    );
  });

  it('firstLogin flag is set on account link success', () => {
    const js = readJS();
    assert.ok(
      js.includes("localStorage.setItem('firstLogin'") || js.includes('localStorage.setItem("firstLogin"'),
      'submitAccountLink must set firstLogin flag in localStorage'
    );
  });

  it('firstLogin flag is checked in applyBoot', () => {
    const js = readJS();
    assert.ok(
      js.includes('firstLogin') && js.includes('localStorage'),
      'applyBoot must check firstLogin flag'
    );
  });
});

describe('Layout v2: Gap fix', () => {
  it('header margin-bottom is reduced', () => {
    const css = readCSS();
    const match = css.match(/\.header\s*\{[^}]*margin-bottom:\s*(\d+)px/);
    if (match) {
      const val = parseInt(match[1]);
      assert.ok(val <= 12, `.header margin-bottom should be <=12px, got ${val}px`);
    }
  });

  it('nav-tabs-minimal margin-bottom is reduced', () => {
    const css = readCSS();
    const match = css.match(/\.nav-tabs-minimal\s*\{[^}]*margin-bottom:\s*(\d+)px/);
    if (match) {
      const val = parseInt(match[1]);
      assert.ok(val <= 12, `.nav-tabs-minimal margin-bottom should be <=12px, got ${val}px`);
    }
  });
});
