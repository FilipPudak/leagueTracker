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
    ['class="nav-tabs"', 'id="status-box"', 'id="retry-load"', 'id="loading-spinner"', 'id="vote-view"', 'id="standings-view"', 'id="leaderboard-view"', 'id="player-profile-view"'].forEach((marker) => {
      const idx = html.indexOf(marker);
      assert.ok(idx > right && idx < left, `${marker} must be inside .col-right`);
    });
  });

  it('link panel lives inside .col-left beside My Stats', () => {
    const html = readHTML();
    const left = html.indexOf('class="col-left"');
    const link = html.indexOf('id="link-view"');
    const myseason = html.indexOf('id="myseason-view"');
    assert.ok(link > left, 'link-view must be inside .col-left');
    assert.ok(link < myseason, 'link-view must precede myseason-view in the left column');
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
      js.includes("sessionStorage.getItem('firstLogin')"),
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
      js.includes("sessionStorage.setItem('firstLogin'") || js.includes('sessionStorage.setItem("firstLogin"'),
      'submitAccountLink must set firstLogin flag in sessionStorage'
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
    assert.ok(html.includes('>My Stats</span></h3>'), 'heading must read "My Stats"');
    assert.ok(html.match(/myseason-heading[^>]*>[\s\S]{0,40}<svg/), 'heading must carry the person icon from the My Stats tab');
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

  it('guest left column shows the sign-in panel, never an empty My Stats', () => {
    const css = readCSS();
    assert.ok(css.match(/body:not\(\.is-linked\)\s+#link-view\s*\{[^}]*display:\s*block/), '#link-view must be forced visible for guests on desktop');
    assert.ok(css.match(/body:not\(\.is-linked\)\s+#myseason-view\s*\{[^}]*display:\s*none/), '#myseason-view must stay hidden for guests on desktop (empty-panel leak guard)');
    assert.ok(css.match(/body:not\(\.is-linked\)\s+#link-back\s*\{[^}]*display:\s*none/), 'guests on desktop must not see the mobile back button');
  });

  it('sign-in CTA pill lives in the header and hides on desktop', () => {
    const css = readCSS();
    const html = readHTML();
    assert.ok(html.includes('id="signin-cta"'), 'header must carry the Sign in pill');
    assert.ok(css.match(/\.signin-cta\s*\{[^}]*display:\s*none/), 'cta hidden by default');
    assert.ok(css.match(/body:not\(\.is-linked\)\s+\.signin-cta\s*\{[^}]*display:\s*inline-block/), 'cta shown for guests');
    const desktop = css.match(/\/\* Desktop \(1024px\+\) \*\/[\s\S]*?\n\}\n/);
    assert.ok(desktop && /body:not\(\.is-linked\)\s+\.signin-cta\s*\{[^}]*display:\s*none/.test(desktop[0]), 'cta hidden again on desktop');
  });

  it('guest boot lands on standings with tabs hidden; invalid-token opens the form on mobile', () => {
    const js = readJS();
    const unlinkedBranch = js.match(/\} else \{[\s\S]*?\n {2}\}\n\n {2}handleHashRoute/);
    assert.ok(unlinkedBranch, 'applyBoot unlinked branch must exist');
    assert.ok(unlinkedBranch[0].includes('showTabs(false)'), 'guests never see the tab bar');
    assert.ok(unlinkedBranch[0].includes("switchTab('standings-view')"), 'guest default view is standings');
    assert.ok(unlinkedBranch[0].includes('innerWidth < 1024'), 'invalid-token branch differentiates mobile vs desktop');
    assert.ok(js.includes('function openSignIn'), 'header pill calls openSignIn');
  });

  it('arrow-key tablist navigation with roving tabindex exists', () => {
    const js = readJS();
    assert.ok(js.includes('function initTabKeyboard'), 'initTabKeyboard must exist');
    assert.ok(js.includes("'ArrowRight'") && js.includes("'ArrowLeft'"), 'arrow keys handled');
    assert.ok(js.includes("setAttribute('tabindex', '-1')") && js.includes("setAttribute('tabindex', '0')"), 'setActiveView syncs roving tabindex');
    const html = readHTML();
    assert.ok(/tabindex="\d+"/.test(html), 'tab buttons carry initial tabindex');
  });
});

describe('Layout v5: Review-fix guards', () => {
  it('vote-cta uses a real design-system class (no phantom .btn/.btn-primary)', () => {
    const html = readHTML();
    assert.ok(!html.includes('btn btn-primary'), 'no button may use undefined .btn/.btn-primary classes');
    const cta = html.match(/id="vote-cta"[\s\S]*?<button[^>]*class="([\w-]+)"/);
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

describe('v4.8.0: Style and symmetry pins', () => {
  it('global .not-you base rule exists (no more unstyled browser-default buttons)', () => {
    const css = readCSS();
    const block = css.match(/\.not-you\s*\{[^}]*\}/);
    assert.ok(block, '.not-you base rule must exist');
    assert.ok(block[0].includes('background: none'), 'must strip native button background');
    assert.ok(block[0].includes('border: none'), 'must strip native button border');
    assert.ok(block[0].includes('min-height: var(--touch-target-min)'), 'must meet touch target');
  });

  it('listbox selects escape the dropdown chevron and min-height', () => {
    const css = readCSS();
    const block = css.match(/select\[size\],[^}]*\{[^}]*\}/);
    assert.ok(block, 'select[size] override rule must exist');
    assert.ok(block[0].includes('background-image: none'), 'no chevron on listboxes');
    assert.ok(block[0].includes('min-height: 0'), 'no dropdown min-height on listboxes');
  });

  it('badge grid columns are 3 on mobile, 4 on tablet and desktop', () => {
    const css = readCSS();
    assert.ok(css.match(/:root\s*\{[^}]*--badge-grid-columns:\s*3/), 'mobile = 3 columns');
    const tablet = css.match(/\/\* Tablet \(768px\+\) \*\/[\s\S]*?--badge-grid-columns:\s*(\d+)/);
    const desktop = css.match(/\/\* Desktop \(1024px\+\) \*\/[\s\S]*?--badge-grid-columns:\s*(\d+)/);
    assert.ok(tablet && tablet[1] === '4', 'tablet portrait = 4 columns');
    assert.ok(desktop && desktop[1] === '4', 'desktop = 4 columns (12 badges => 4x3, no ragged rows)');
  });

  it('desktop columns are equal width for symmetric chrome bars', () => {
    const css = readCSS();
    assert.ok(css.match(/\.desktop-columns\s*\{[^}]*grid-template-columns:\s*1fr 1fr/), 'grid must use 1fr 1fr');
  });

  it('link back button exists in the link panel', () => {
    const html = readHTML();
    assert.ok(html.includes('id="link-back"'), 'back button must exist');
    assert.ok(html.includes('Back to standings'), 'back button must be labelled');
  });
});

describe('v4.8.5: modal and profile UX guards', () => {
  it('player modal is a dialog with close affordances', () => {
    const html = readHTML();
    assert.ok(html.includes('id="player-modal-overlay" class="modal-overlay" role="dialog" aria-modal="true"'), 'overlay must declare dialog semantics');
    assert.ok(html.includes('aria-label="Close player summary"'), 'close button needs an accessible name');
    assert.ok(html.includes('id="player-modal-close"'), 'close button needs a stable id for focus handling');
  });

  it('modal box sizing lives in CSS, not inline styles (desktop 640px rule must apply)', () => {
    const html = readHTML();
    const css = readCSS();
    assert.ok(!html.includes('max-width:480px; max-height:80vh'), 'no inline sizing on the modal box');
    assert.ok(css.includes('.player-modal-box'), '.player-modal-box class must exist');
    assert.ok(css.includes('position: sticky'), 'modal header must be sticky');
  });

  it('Escape closes the player modal', () => {
    const js = readJS();
    assert.ok(js.includes("e.key === 'Escape'"), 'a global Escape handler must exist');
    assert.ok(js.includes('function initModalKeys'), 'Escape wiring must live in initModalKeys');
  });

  it('modal shows an empty state instead of zero-filled tiles', () => {
    const js = readJS();
    assert.ok(js.includes('No season results yet.'), 'empty-state copy must exist');
    assert.ok(js.includes('player-modal-empty'), 'empty-state class must exist');
  });

  it('player names are real buttons everywhere they open the modal', () => {
    const js = readJS();
    assert.equal((js.match(/class="name-btn/g) || []).length, 2, 'standings cell and round rows must both use name-btn');
  });

  it('one section-heading atom replaces the inline heading idioms', () => {
    const html = readHTML();
    const css = readCSS();
    const js = readJS();
    assert.ok(css.includes('.section-heading'), 'shared heading class must exist');
    assert.ok(!css.includes('.player-modal-section-title'), 'outlier bordered heading class must be gone');
    assert.ok(!/<h3 style=/.test(html), 'no inline-styled h3 headings in the markup');
    assert.ok(!js.includes('headingStyle'), 'heading-style opts machinery must be gone');
  });
});

describe('v4.9.0: flow and accessibility guards', () => {
  it('vote opponent hint reflects faced-only filtering', () => {
    const html = readHTML();
    const js = readJS();
    assert.ok(html.includes('id="opponent-hint"'), 'hint must have a stable id');
    assert.ok(js.includes('appState.playersFiltered'), 'client must track the facedOnly flag');
    assert.ok(js.includes('Showing only the opponents you faced on Night'), 'filtered hint copy must exist');
  });

  it('season selectors share one browsing state', () => {
    const html = readHTML();
    const js = readJS();
    assert.equal((html.match(/onSeasonFilterChange/g) || []).length, 4, 'all four season selects must sync');
    assert.ok(js.includes("localStorage.setItem(KEY_BROWSING_SEASON"), 'browsing season must persist');
    assert.ok(js.includes('function seasonForBrowsing'), 'shared season getter must exist');
  });

  it('tab state and async feedback are announced', () => {
    const html = readHTML();
    const js = readJS();
    assert.ok(js.includes("setAttribute('aria-selected', 'true')"), 'aria-selected must track activation');
    assert.ok(html.includes('id="status-box" class="status-msg" role="status" aria-live="polite"'), 'status box must be a live region');
    assert.ok(html.includes('<div class="career-tabs" role="tablist"'), 'career segments must expose tablist semantics');
    assert.ok(html.includes('<div class="profile-tabs" role="tablist"'), 'profile segments must expose tablist semantics');
  });

  it('phones get the fixed bottom tab bar too', () => {
    const css = readCSS();
    const phone = css.match(/@media \(max-width: 767px\)\s*\{[\s\S]*?\n\}/);
    assert.ok(phone && phone[0].includes('.nav-tabs') && phone[0].includes('position: fixed'), 'nav must be fixed at bottom below 768px');
  });

  it('link picker renders accessible rows with an empty state', () => {
    const html = readHTML();
    const js = readJS();
    const css = readCSS();
    assert.ok(html.includes('role="group"'), 'picker must expose group semantics');
    assert.ok(html.includes('id="link-picker-empty"'), 'no-match state must exist');
    assert.ok(js.includes('function renderLinkPicker'), 'row renderer must exist');
    assert.ok(!js.includes('select.value = prefill.playerId'), 'legacy select wiring must be gone');
    assert.ok(css.includes('.picker-row'), 'picker row styling must exist');
  });
});

describe('v4.9.1: badge tap fix and modal a11y finishing', () => {
  it('badge tap suppresses the synthetic click that used to re-toggle the tooltip', () => {
    const js = readJS();
    assert.match(js, /function onTouchEnd\(ev\)/, 'touchend handler must receive its own event');
    assert.ok(js.includes('ev.preventDefault();'), 'preventDefault must run on the touchend event');
    assert.ok(js.includes("grid.removeEventListener('touchcancel', onTouchCancel)"), 'touchcancel must detach listeners');
  });

  it('badge tooltip flips below when near the viewport top', () => {
    const js = readJS();
    const css = readCSS();
    assert.ok(js.includes('placeBelow'), 'tooltip must support below placement');
    assert.ok(css.includes('.badge-tooltip.below::after'), 'arrow must flip for below placement');
  });

  it('open modals lock body scroll and trap tab focus', () => {
    const js = readJS();
    assert.ok(js.includes('function updateBodyScrollLock'), 'scroll lock helper must exist');
    assert.equal((js.match(/updateBodyScrollLock\(\);/g) || []).length, 4, 'all four open/close sites must call it');
    assert.ok(js.includes('function trapFocus'), 'focus trap must exist');
    assert.ok(js.includes("trapFocus(e, pm)"), 'Tab must be routed through the trap');
  });
});
