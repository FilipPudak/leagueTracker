import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readSource } from '../helpers/read-source.js';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const JS_FILE = join(__dirname, '../../../docs/app/app.js');
const HTML_FILE = join(__dirname, '../../../docs/app/index.html');

function readJS() { return readSource(JS_FILE); }
function readHTML() { return readSource(HTML_FILE); }

function between(html, startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start + startMarker.length);
  assert.ok(start !== -1 && end > start, `markers ${startMarker} / ${endMarker} must exist and be ordered`);
  return html.slice(start, end);
}

describe('Voting Milestones placement (index.html)', () => {
  it('section heading is plural "Voting Milestones"', () => {
    const html = readHTML();
    assert.ok(html.includes('Voting Milestones'), 'heading must be "Voting Milestones"');
    assert.ok(!html.includes('>Voting Milestone<'), 'old singular heading must be gone');
  });

  it('lives at the end of the Vote view, after the weekly participation card', () => {
    const vote = between(readHTML(), 'id="vote-view"', 'id="standings-view"');
    const section = vote.indexOf('id="vote-milestones-section"');
    const participation = vote.indexOf('id="weekly-participation-card"');
    assert.ok(section !== -1, 'vote-milestones-section must live inside #vote-view');
    assert.ok(participation !== -1 && section > participation,
      'keep the vote form + social proof clustered before the milestones');
  });

  it('is absent from My Stats', () => {
    const myStats = between(readHTML(), 'id="myseason-view"', '/col-left');
    for (const id of ['vote-milestones-section', 'vote-milestone-container', 'vote-milestones-container']) {
      assert.ok(!myStats.includes(`id="${id}"`), `${id} must not remain in My Stats`);
    }
  });

  it('keeps the heading inside the hideable wrapper', () => {
    const html = readHTML();
    const start = html.indexOf('id="vote-milestones-section"');
    const end = html.indexOf('id="vote-milestone-container"');
    assert.ok(start !== -1 && end > start);
    assert.ok(html.slice(start, end).includes('Voting Milestones'),
      'heading must be inside the wrapper so the no-vote explanation has a title');
  });

  it('has a labelled per-section season selector that syncs with the others', () => {
    const html = readHTML();
    assert.ok(html.includes('<label for="vote-milestones-season-filter">'), 'select must be labelled');
    assert.ok(html.includes('id="vote-milestones-season-filter" data-season-sync="true"'),
      'new selector joins the shared season-sync family');
    assert.ok(html.includes('id="vote-milestones-context"'), 'context subtitle element must exist');
    assert.equal((html.match(/data-season-sync="true"/g) || []).length, 5, 'five season selectors now');
  });

  it('has compliance container with bar, text and reward copy', () => {
    const html = readHTML();
    ['id="compliance-container"', 'id="compliance-bar"', 'id="compliance-text"', 'id="compliance-reward"']
      .forEach((marker) => {
        assert.ok(html.includes(marker), `${marker} must exist`);
      });
  });

  it('compliance card lives inside the milestones section, after the milestone card', () => {
    const html = readHTML();
    const section = html.indexOf('id="vote-milestones-section"');
    const milestone = html.indexOf('id="vote-milestone-container"');
    const compliance = html.indexOf('id="compliance-container"');
    const container = html.indexOf('id="vote-milestones-container"');
    assert.ok(section !== -1, 'milestones section must exist');
    assert.ok(compliance > milestone && compliance < container,
      'compliance card must sit between milestone card and tickets/streak container');
  });

  it('reward copy is built from the server threshold, not hardcoded', () => {
    const html = readHTML();
    const js = readJS();
    assert.ok(/id="compliance-reward"/.test(html), 'compliance-reward element must exist');
    assert.ok(/'Vote in ' \+ res\.compliance\.target/.test(js), 'reward copy must derive from compliance.target');
    assert.ok(/season end \(min\. ' \+ res\.compliance\.minVotes \+ ' votes\)/.test(js),
      'reward copy must state the vote floor from the payload');
    assert.ok(!js.includes('min. 4 votes'), 'the floor must not be hardcoded in the reward copy');
    assert.ok(/season end/i.test(js), 'copy must mention the season-end prize');
    assert.ok(!js.includes('Vote in 80% of'), 'copy must not hardcode the threshold');
  });

  it('milestone reward copy derives from milestone target', () => {
    const html = readHTML();
    const js = readJS();
    assert.ok(/id="milestone-reward"/.test(html), 'milestone-reward element must exist');
    assert.ok(/target \+ ' votes earn you a prize/.test(js), 'reward copy must derive from milestone target');
    assert.ok(/ask in our Discord/.test(js), 'reward wording must stay');
  });

  it('static reward lines stay empty (copy comes from the payload)', () => {
    const html = readHTML();
    const milestone = html.match(/id="milestone-reward"[^>]*>([^<]*)</);
    const compliance = html.match(/id="compliance-reward"[^>]*>([^<]*)</);
    assert.ok(milestone && compliance, 'both reward elements must exist');
    assert.equal(milestone[1].trim(), '', 'milestone reward line must be filled by the renderer');
    assert.equal(compliance[1].trim(), '', 'compliance reward line must be filled by the renderer');
  });

  it('My Stats now hosts the shared season container, not the old gamification/awards/leaders rows', () => {
    const myStats = between(readHTML(), 'id="myseason-view"', '/col-left');
    assert.ok(myStats.includes('id="myseason-season-container"'), 'shared season container must exist');
    for (const id of ['myseason-awards-container', 'myseason-leaders-container', 'myseason-content']) {
      assert.ok(!myStats.includes(`id="${id}"`), `${id} was replaced by the shared season renderer`);
    }
  });
});

describe('Season selector wiring', () => {
  it('derives the selector list from data-season-sync (no third hardcoded array)', () => {
    const js = readJS();
    assert.ok(/const SEASON_SELECTORS = Array\.from\(document\.querySelectorAll\('\[data-season-sync\]'\)/.test(js),
      'SEASON_SELECTORS must be derived from the DOM, not a hardcoded list');
    assert.ok(!/const SEASON_SELECTORS = \[/.test(js), 'no literal selector array left');
  });

  it('boot population also comes from data-season-sync', () => {
    const js = readJS();
    const fn = js.slice(js.indexOf('function applyBoot'), js.indexOf('function applyBoot') + 4000);
    assert.ok(fn.includes('SEASON_SELECTORS.forEach('),
      'every synced selector, including the new one, is populated at boot');
  });

  it('seasonReload maps the new selector to the private loader', () => {
    const js = readJS();
    assert.ok(/'vote-milestones-season-filter': loadPrivateStats/.test(js),
      'changing the milestone season must refresh the private payload');
  });

  it('changing any synced season refreshes private stats when their surfaces are visible', () => {
    const js = readJS();
    const fn = js.slice(js.indexOf('function onSeasonFilterChange'), js.indexOf('function onSeasonFilterChange') + 900);
    assert.ok(fn.includes('loadPrivateStats()'), 'onSeasonFilterChange must refresh the private payload');
    assert.ok(/innerWidth >= 1024/.test(fn), 'desktop always shows the My Stats panel');
    assert.ok(/vote-view/.test(fn) && /myseason-view/.test(fn), 'mobile refreshes only when vote/myseason is active');
  });
});

describe('Private stats loader (app.js)', () => {
  it('replaced the old named loader and reads the browsing season', () => {
    const js = readJS();
    assert.ok(/function loadPrivateStats\(/.test(js), 'loadPrivateStats must exist');
    assert.ok(!/function loadMySeasonStats\(/.test(js), 'old loader must be gone');
    const fn = js.slice(js.indexOf('function loadPrivateStats'), js.indexOf('function complianceStatusSuffix'));
    assert.ok(fn.includes('seasonForBrowsing()'), 'private loader honours the shared season picker');
    assert.ok(fn.includes('getMySeasonStats'), 'still backed by the private endpoint');
    assert.ok(fn.includes('LeagueCore.PRIVATE_CACHE_TTL_MS'), 'private cache uses the 30s TTL');
  });

  it('renders both surfaces from one response', () => {
    const js = readJS();
    const fn = js.slice(js.indexOf('function loadPrivateStats'), js.indexOf('function complianceStatusSuffix'));
    assert.ok(fn.includes('renderVoteMilestones('), 'milestones on the vote tab');
    assert.ok(fn.includes('renderMySeasonStats('), 'season stats on My Stats');
    assert.equal((fn.match(/callApi\('getMySeasonStats'/g) || []).length, 1, 'one fetch serves both');
  });

  it('fails silently (no global status box), with an inline notice and console warning', () => {
    const js = readJS();
    const fn = js.slice(js.indexOf('function loadPrivateStats'), js.indexOf('function complianceStatusSuffix'));
    assert.ok(!fn.includes('showStatus('), 'silent path must never use the global red status box');
    assert.ok(fn.includes('console.warn('), 'failures are logged for debugging');
    assert.ok(fn.includes('vote-milestones'), 'inline notice lands in the milestones surface');
    assert.ok(!fn.includes('showSpinner('), 'silent path avoids spinner-owner fights');
  });

  it('keeps in-flight and token guards so duplicate tab opens do not double-fetch', () => {
    const js = readJS();
    const fn = js.slice(js.indexOf('function loadPrivateStats'), js.indexOf('function complianceStatusSuffix'));
    assert.ok(fn.includes('mystatsInFlight'), 'in-flight guard kept');
    assert.ok(fn.includes('mystatsToken'), 'token guard kept');
  });

  it('vote tab and post-vote both refresh private stats', () => {
    const js = readJS();
    const voteBranch = js.slice(js.indexOf("tabId === 'vote-view'"), js.indexOf("tabId === 'standings-view'"));
    assert.ok(voteBranch.includes('loadPrivateStats()'), 'opening the vote tab loads milestones');
    const submit = js.slice(js.indexOf('function submitVotes'), js.indexOf('/* ----------------------------------------------------------- standings'));
    assert.ok(submit.includes('loadPrivateStats()'), 'a cast vote updates milestones immediately');
    assert.ok(submit.includes('appState.mystatsCache = {}'), 'vote success clears the private cache');
  });

  it('My Stats renderer tolerates an old backend payload', () => {
    const js = readJS();
    const fn = js.slice(js.indexOf('function renderMySeasonStats'), js.indexOf('function loadCareerStats'));
    assert.ok(fn.includes('!res.season'), 'old Worker → new frontend must not crash');
    assert.ok(fn.includes('playerSeasonHtml('), 'shared season renderer is used');
    assert.ok(fn.includes('myseason-season-container'), 'renders into the new container');
  });
});

describe('Compliance rendering (still source-driven)', () => {
  it('renders res.compliance from the shared helpers', () => {
    const js = readJS();
    assert.ok(/res\.compliance/.test(js), 'renderer must read res.compliance');
    assert.equal((js.match(/renderComplianceCard\(/g) || []).length, 2,
      'compliance card helper is defined once and called once');
    assert.match(html(), /id="compliance-container"/, 'compliance card exists');
    assert.ok(/LeagueCore\.gamificationViewFor/.test(js));
  });

  it('uses the context subtitle for a stale browsing season', () => {
    const js = readJS();
    const fn = js.slice(js.indexOf('function renderVoteMilestones'), js.indexOf('function renderMySeasonStats'));
    assert.ok(fn.includes('seasonContextLabel('), 'subtitle disambiguates the selected season');
    assert.ok(fn.includes('vote-milestones-context'));
  });

  it('shows explanatory copy for pre-voting seasons instead of disappearing', () => {
    const js = readJS();
    const fn = js.slice(js.indexOf('function renderVoteMilestones'), js.indexOf('function renderMySeasonStats'));
    assert.ok(fn.includes("view === 'hidden'"), 'hidden view is handled explicitly');
    assert.ok(/Voting started in Season 7/.test(fn), 'no-vote seasons need explanatory copy');
    assert.ok(fn.includes('vote-milestones-section'), 'heading wrapper stays visible');
  });

  it('keeps the ratio and server-provided threshold copy', () => {
    const js = readJS();
    assert.ok(/' \(need ' \+ compliance\.target \+ '%\)'/.test(js));
    assert.ok(/compliance\.pct/.test(js));
    assert.ok(!js.includes('need 80%'));
    assert.ok(/target not met/.test(js));
    assert.ok(/on track/i.test(js) && /Prize earned/.test(js));
    assert.ok(/compliance\.attended\s*>\s*0/.test(js));
  });

  it('milestone labels stay shared and clamped', () => {
    const js = readJS();
    const start = js.indexOf('function milestoneCountLabel');
    const fn = js.slice(start, start + 400);
    assert.ok(/Math\.min\(/.test(fn));
    assert.ok(fn.includes("milestone.complete ? ' — Prize earned!' : ''"));
    assert.ok(fn.includes("' cast)'"));
    assert.ok(!js.includes("votes + ' of ' + target"));
  });
});

describe('Night-by-night shared rendering', () => {
  it('sorts a copy newest-first and shows three with a toggle', () => {
    const js = readJS();
    const fn = js.slice(js.indexOf('function playerSeasonHtml'), js.indexOf('function leaderRowHtml'));
    assert.ok(fn.includes('LeagueCore.nightsNewestFirst('), 'shared pure sort used');
    assert.ok(/LeagueCore\.visibleListSlice\(sorted, 3, expanded\)/.test(fn), 'show three by default');
    assert.ok(/LeagueCore\.listToggleLabel\(sorted\.length, 3, expanded, 'nights'\)/.test(fn));
    assert.ok(fn.includes('data-nights-toggle'), 'delegated toggle hook present');
    assert.ok(fn.includes('data-nights-key'), 'per-player expand state key');
    assert.ok(!fn.includes('.sort('), 'no in-place sort on the payload');
  });

  it('modal, profile and My Stats all route through the shared HTML builder', () => {
    const js = readJS();
    assert.ok(/playerSeasonHtml\(data\.season, \{ surface: 'modal'/.test(js), 'modal');
    assert.ok(/playerSeasonHtml\(data\.season, \{ headingTag: 'h3'/.test(js), 'profile');
    const myStats = js.slice(js.indexOf('function renderMySeasonStats'), js.indexOf('function loadCareerStats'));
    assert.ok(myStats.includes('playerSeasonHtml('), 'My Stats');
    assert.equal((js.match(/function renderSeasonContent\(/g) || []).length, 0,
      'the old in-place renderer was fully extracted');
  });

  it('per-player expand state is keyed by surface and player, toggled by delegation', () => {
    const js = readJS();
    assert.ok(/listExpanded\[key\] = !listExpanded\[key\]/.test(js), 'per-key toggle');
    assert.ok(/surface \+ ':' \+ playerId/.test(js), 'key combines surface and player');
    for (const id of ['player-modal-content', 'profile-season-content', 'myseason-season-container']) {
      assert.ok(new RegExp(`on\\('${id}', 'click'`).test(js), `${id} hosts a delegated nights toggle`);
    }
  });
});

function html() { return readHTML(); }
