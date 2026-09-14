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
  it('desktop uses a two-item grid of column wrappers', () => {
    const css = readCSS();
    const desktop = css.match(/\.desktop-columns\s*\{[^}]*display:\s*grid[^}]*grid-template-columns/);
    assert.ok(desktop, '.desktop-columns must be the 2-column grid');
    assert.ok(css.match(/\.col-left\s*\{[^}]*grid-column:\s*1/), '.col-left must be column 1');
    assert.ok(css.match(/\.col-right\s*\{[^}]*grid-column:\s*2/), '.col-right must be column 2');
  });

  it('both wrappers pinned to grid-row 1 (auto-placement cursor must not push col-left to row 2)', () => {
    const css = readCSS();
    assert.ok(css.match(/\.col-left\s*\{[^}]*grid-row:\s*1/), '.col-left must have explicit grid-row: 1');
    assert.ok(css.match(/\.col-right\s*\{[^}]*grid-row:\s*1/), '.col-right must have explicit grid-row: 1');
  });

  it('wrappers collapse to invisible on mobile (display: contents)', () => {
    const css = readCSS();
    assert.ok(
      css.match(/\.desktop-columns,\s*\.col-right,\s*\.col-left\s*\{\s*display:\s*contents/),
      'all three wrappers must be display:contents at base so mobile flow is unchanged'
    );
  });

  it('tabs, status, retry, spinner and profile panels live inside .col-right', () => {
    const html = readHTML();
    const right = html.indexOf('class="col-right"');
    const left = html.indexOf('class="col-left"');
    ['class="nav-tabs"', 'id="status-box"', 'id="retry-load"', 'id="loading-spinner"', 'id="vote-view"', 'id="standings-view"', 'id="leaderboard-view"', 'id="link-view"', 'id="player-profile-view"'].forEach((marker) => {
      const idx = html.indexOf(marker);
      assert.ok(idx > right && idx < left, `${marker} must be inside .col-right`);
    });
  });

  it('myseason panel is the single item inside .col-left', () => {
    const html = readHTML();
    const left = html.indexOf('class="col-left"');
    const panel = html.indexOf('id="myseason-view"');
    assert.ok(panel > left, 'myseason-view must be inside .col-left');
    const css = readCSS();
    const block = css.match(/#myseason-view\s*\{[^}]*\}/);
    assert.ok(block && !block[0].includes('grid-row'), '#myseason-view must not be pinned to a grid row (columns are independent now)');
  });

  it('nav-tabs and heading share equal chrome heights on desktop', () => {
    const css = readCSS();
    assert.ok(css.match(/\.myseason-heading\s*\{[^}]*min-height:/), 'heading must have min-height matching the tab bar');
    assert.ok(css.match(/\.myseason-heading\s*\{[^}]*background-color:\s*#090d16/), 'heading must use the tab-bar pill background');
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
    const match = css.match(/\.nav-tabs\s*\{\s*margin-bottom:\s*(\d+)px\s*;?\s*\}/);
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
    assert.ok(css.match(/\.myseason-heading\s*\{[^}]*display:\s*flex/), 'desktop media query must show the heading as a flex bar');
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

  it('col-left hidden and col-right spans when unlinked on desktop', () => {
    const css = readCSS();
    assert.ok(css.match(/body:not\(\.is-linked\)\s+\.col-left\s*\{[^}]*display:\s*none/), '.col-left must be hidden while unlinked');
    assert.ok(css.match(/body:not\(\.is-linked\)\s+\.col-right\s*\{[^}]*grid-column:\s*1 \/ -1/), '.col-right must span both columns when unlinked');
  });
});

describe('Layout v5: Review-fix guards', () => {
  it('vote-cta uses a real design-system class (no phantom .btn/.btn-primary)', () => {
    const html = readHTML();
    assert.ok(!html.includes('btn btn-primary'), 'no button may use undefined .btn/.btn-primary classes');
    const cta = html.match(/id="vote-cta"[\s\S]*?<button class="([\w-]+)"/);
    assert.ok(cta && cta[1] === 'btn-submit', 'vote-cta button must use .btn-submit');
  });

  it('desktop never activates myseason-view as a tab view', () => {
    const js = readJS();
    assert.ok(
      /function switchTab\(tabId\)\s*\{[\s\S]{0,200}innerWidth >= 1024 && tabId === 'myseason-view'/.test(js),
      'switchTab must redirect myseason-view to standings-view on desktop'
    );
    assert.ok(
      js.includes("appState.lastView === 'myseason-view'"),
      'resize listener must normalize lastView when growing to desktop'
    );
  });

  it('no setActiveView call passes the dead second argument', () => {
    const js = readJS();
    assert.ok(!/setActiveView\('[^']+',\s*\d/.test(js), 'setActiveView must be called with a single argument');
  });
});

describe('Layout v4: Asset cache-busting stamps', () => {
  it('all local asset links carry a ?v= stamp', () => {
    const html = readHTML();
    ['styles.css', 'app-core.js', 'app.js'].forEach((asset) => {
      assert.ok(
        html.includes(`${asset}?v=`),
        `${asset} link must carry a ?v= cache-busting stamp`
      );
    });
  });

  it('stamp equals APP_VERSION so releases always fetch fresh assets', () => {
    const html = readHTML();
    const js = readJS();
    const version = js.match(/APP_VERSION\s*=\s*'([^']+)'/)[1];
    const stamps = [...html.matchAll(/[?&]v=([\d.]+)/g)].map((m) => m[1]);
    assert.ok(stamps.length >= 3, 'at least three stamped links expected');
    stamps.forEach((s) => assert.equal(s, version, 'each asset stamp must equal APP_VERSION'));
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
