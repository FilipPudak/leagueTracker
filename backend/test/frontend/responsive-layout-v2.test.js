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

describe('Layout v3: Identity chip in header status row', () => {
  it('identity-chip is inside header', () => {
    const html = readHTML();
    const chipIdx = html.indexOf('id="identity-chip"');
    const headerStart = html.indexOf('class="header"');
    const tabsIdx = html.indexOf('class="nav-tabs"');
    assert.ok(chipIdx > headerStart && chipIdx < tabsIdx, 'identity-chip must be inside .header');
  });

  it('identity-chip shares .header-status row with the voting badge', () => {
    const html = readHTML();
    const statusIdx = html.indexOf('class="header-status"');
    const badgeIdx = html.indexOf('id="voting-badge"');
    const chipIdx = html.indexOf('id="identity-chip"');
    assert.ok(statusIdx !== -1, '.header-status wrapper must exist');
    assert.ok(badgeIdx > statusIdx && chipIdx > statusIdx, 'badge and chip must be inside .header-status');
  });

  it('identity-chip has no "Voting as" label', () => {
    const html = readHTML();
    assert.ok(!html.includes('Voting as'), 'chip must not carry the "Voting as" label');
    assert.ok(!html.includes('chip-label'), 'chip-label element must be removed');
  });

  it('.header-status is a centered wrapping flex row', () => {
    const css = readCSS();
    const match = css.match(/\.header-status\s*\{[^}]*display:\s*flex[^}]*justify-content:\s*center/);
    assert.ok(match, '.header-status must be a centered flex row');
    assert.ok(css.match(/\.header-status\s*\{[^}]*flex-wrap:\s*wrap/), '.header-status must wrap');
  });

  it('.identity-chip is flat (no box) and nowrap', () => {
    const css = readCSS();
    const block = css.match(/\.identity-chip\s*\{[^}]*\}/);
    assert.ok(block, '.identity-chip rule must exist');
    assert.ok(!block[0].includes('background'), 'chip must have no background box');
    assert.ok(!block[0].includes('border'), 'chip must have no border box');
    assert.ok(block[0].includes('white-space: nowrap'), 'chip must be nowrap');
  });
});

describe('Layout v3: Desktop 2-panel', () => {
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

  it('header spans full width while tabs sit in the right column', () => {
    const css = readCSS();
    assert.ok(css.match(/\.header\s*\{\s*grid-column:\s*1 \/ -1/), '.header must span grid-column: 1 / -1');
    assert.ok(css.match(/\.nav-tabs\s*\{\s*grid-column:\s*2/), '.nav-tabs must be grid-column: 2 at desktop');
  });

  it('status, retry, spinner, profile panel are right-column chrome', () => {
    const css = readCSS();
    const block = css.match(/#status-box,\s*#retry-load,\s*#loading-spinner,\s*#player-profile-view\s*\{[^}]*grid-column:\s*2/);
    assert.ok(block, 'status/retry/spinner/profile must be grid-column: 2');
  });

  it('myseason panel pinned to the tab row and top-aligned', () => {
    const css = readCSS();
    const block = css.match(/#myseason-view\s*\{[^}]*\}/);
    assert.ok(block, '#myseason-view rule must exist');
    assert.ok(block[0].includes('grid-column: 1'), 'must be in column 1');
    assert.ok(block[0].includes('grid-row: 2'), 'must sit on the tab row');
    assert.ok(block[0].includes('align-self: start'), 'must not stretch to content rows');
  });

  it('My Stats tab hidden from nav-tabs on desktop', () => {
    const css = readCSS();
    const match = css.match(/\.nav-tabs\s+\.tab-btn\[aria-controls="myseason-view"\]\s*\{[^}]*display:\s*none/);
    assert.ok(match, 'My Stats tab must have display:none in .nav-tabs at desktop');
  });

  it('no .nav-tabs-minimal class exists', () => {
    const css = readCSS();
    assert.ok(!css.includes('.nav-tabs-minimal'), '.nav-tabs-minimal must be removed');
  });
});

describe('Layout v3: Boot flow', () => {
  it('standings loads via switchTab (fetches data), not bare setActiveView', () => {
    const js = readJS();
    assert.ok(
      js.includes("switchTab('standings-view')"),
      'applyBoot must call switchTab(standings-view) so standings data loads'
    );
    assert.ok(
      js.includes("localStorage.getItem('firstLogin')"),
      'applyBoot must check firstLogin before choosing view'
    );
  });

  it('firstLogin path goes to vote-view', () => {
    const js = readJS();
    assert.ok(js.includes("switchTab('vote-view')"), 'applyBoot must route firstLogin to vote-view');
  });

  it('desktop boot loads My Stats data (persistent panel)', () => {
    const js = readJS();
    assert.ok(
      js.includes('innerWidth >= 1024') && js.includes('loadMySeasonStats()') && js.includes('loadCareerStats()'),
      'applyBoot must load season + career stats on desktop where the panel is always visible'
    );
  });

  it('firstLogin flag is set on account link success', () => {
    const js = readJS();
    assert.ok(
      js.includes("localStorage.setItem('firstLogin'") || js.includes('localStorage.setItem("firstLogin"'),
      'submitAccountLink must set firstLogin flag in localStorage'
    );
  });
});

describe('Layout v3: No hardcoded active tab in HTML', () => {
  it('no tab button is active by default in HTML', () => {
    const html = readHTML();
    const tabsStart = html.indexOf('class="nav-tabs"');
    const tabsEnd = html.indexOf('id="status-box"');
    const tabsBlock = html.slice(tabsStart, tabsEnd);
    assert.ok(!tabsBlock.includes('tab-btn active'), 'no tab may carry hardcoded active class');
    assert.ok(!tabsBlock.includes('aria-selected="true"'), 'no tab may carry hardcoded aria-selected=true');
  });

  it('setActiveView has no viewport special-casing', () => {
    const js = readJS();
    const fn = js.match(/function setActiveView\(viewId\)\s*\{[\s\S]*?\n\}/);
    assert.ok(fn, 'setActiveView must exist');
    assert.ok(!fn[0].includes('innerWidth'), 'setActiveView must not special-case viewport');
  });
});

describe('Layout v3: Gap fix', () => {
  it('header margin-bottom is reduced', () => {
    const css = readCSS();
    const match = css.match(/\.header\s*\{[^}]*margin-bottom:\s*(\d+)px/);
    if (match) {
      const val = parseInt(match[1]);
      assert.ok(val <= 12, `.header margin-bottom should be <=12px, got ${val}px`);
    }
  });

  it('nav-tabs margin-bottom is reduced on desktop', () => {
    const css = readCSS();
    const match = css.match(/\.nav-tabs\s*\{\s*grid-column:\s*2;\s*margin-bottom:\s*(\d+)px/);
    assert.ok(match, 'desktop .nav-tabs margin-bottom must be set');
    assert.ok(parseInt(match[1]) <= 12, 'desktop .nav-tabs margin-bottom should be <=12px');
  });
});

describe('Layout v3: My Stats panel heading', () => {
  it('myseason-view has a heading as its first child', () => {
    const html = readHTML();
    const panelIdx = html.indexOf('id="myseason-view"');
    const headingIdx = html.indexOf('class="myseason-heading"');
    const careerIdx = html.indexOf('id="career-details"');
    assert.ok(panelIdx !== -1 && headingIdx > panelIdx && headingIdx < careerIdx, '.myseason-heading must be first child of #myseason-view');
    assert.ok(html.includes('My Stats</h3>'), 'heading must read "My Stats"');
  });

  it('heading is hidden below desktop, shown at desktop', () => {
    const css = readCSS();
    const base = css.match(/\.myseason-heading\s*\{[^}]*display:\s*none/);
    assert.ok(base, '.myseason-heading must default to display: none');
    assert.ok(css.match(/\.myseason-heading\s*\{\s*display:\s*block\s*;?\s*\}/), 'desktop media query must show the heading');
  });
});

describe('Layout v3: Unlinked desktop', () => {
  it('applyBoot toggles is-linked body class from boot status', () => {
    const js = readJS();
    assert.ok(
      js.includes("classList.toggle('is-linked'") && js.includes("boot.status === 'linked'"),
      'applyBoot must toggle is-linked body class'
    );
  });

  it('myseason panel hidden and link-view spans when unlinked on desktop', () => {
    const css = readCSS();
    assert.ok(css.includes('body:not(.is-linked) #myseason-view'), 'My Stats must be hidden while unlinked');
    assert.ok(css.match(/body:not\(\.is-linked\)\s+#link-view\s*\{[^}]*grid-column:\s*1 \/ -1/), 'link-view must span both columns when unlinked');
  });
});

describe('Layout v3: aria-labelledby targets exist', () => {
  it('every panel aria-labelledby id matches a tab button id', () => {
    const html = readHTML();
    const labels = [...html.matchAll(/aria-labelledby="(tab-[\w-]+)"/g)].map((m) => m[1]);
    assert.ok(labels.length >= 4, 'panels must reference tab labels');
    labels.forEach((id) => {
      assert.ok(html.includes(`id="${id}"`), `referenced id "${id}" must exist on a tab button`);
    });
  });
});
