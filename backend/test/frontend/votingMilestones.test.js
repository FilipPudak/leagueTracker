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

describe('Voting Milestones section (index.html)', () => {
  it('section heading is plural "Voting Milestones"', () => {
    const html = readHTML();
    assert.ok(html.includes('Voting Milestones'), 'heading must be "Voting Milestones"');
    assert.ok(!html.includes('>Voting Milestone<'), 'old singular heading must be gone');
  });

  it('has compliance container with bar, text and reward copy', () => {
    const html = readHTML();
    ['id="compliance-container"', 'id="compliance-bar"', 'id="compliance-text"', 'id="compliance-reward"']
      .forEach((marker) => {
        assert.ok(html.includes(marker), `${marker} must exist`);
      });
  });

  it('compliance card lives inside the gamification section, after the milestone card', () => {
    const html = readHTML();
    const section = html.indexOf('id="myseason-gamification-section"');
    const milestone = html.indexOf('id="myseason-milestone-container"');
    const compliance = html.indexOf('id="compliance-container"');
    const container = html.indexOf('id="myseason-gamification-container"');
    assert.ok(section !== -1, 'gamification section must exist');
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
    assert.ok(/target \+ ' votes earns you a prize/.test(js), 'reward copy must derive from milestone target');
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
});

describe('renderMySeasonStats compliance rendering (app.js)', () => {
  it('reads res.compliance and drives the compliance bar/text', () => {
    const js = readJS();
    assert.ok(/res\.compliance/.test(js), 'renderer must read res.compliance');
    ['compliance-container', 'compliance-bar', 'compliance-text'].forEach((id) => {
      assert.ok(js.includes(`'${id}'`) || js.includes(`"${id}"`), `renderer must reference ${id}`);
    });
  });

  it('shows the ratio and the server-provided threshold', () => {
    const js = readJS();
    assert.ok(/' \(need ' \+ compliance\.target \+ '%\)'/.test(js),
      'non-qualifying state must show the threshold from the payload');
    assert.ok(/compliance\.pct/.test(js), 'bar text must include the computed pct');
    assert.ok(!js.includes('need 80%'), 'threshold must not be hardcoded in the renderer');
  });

  it('keeps the vote floor out of the status suffix (the subtitle owns it)', () => {
    const js = readJS();
    const start = js.indexOf('function complianceStatusSuffix');
    const end = js.indexOf('function renderComplianceCard');
    assert.ok(start !== -1 && end > start, 'suffix function must exist');
    const fn = js.slice(start, end);
    assert.ok(!fn.includes('minVotes'), 'the floor must not appear in the status suffix');
    assert.ok(fn.includes("return '';"), 'floor-blocked state must render no need-marker');
    assert.ok(!js.includes('need 4 votes'), 'floor copy must not be hardcoded anywhere');
  });

  it('closed non-qualifying state uses past-tense copy', () => {
    const js = readJS();
    assert.ok(/target not met/.test(js), 'closed non-qualifier must say "target not met"');
  });

  it('summary reuses the shared suffix for closed-season copy', () => {
    const js = readJS();
    assert.ok(!js.includes('res.compliance.qualifying ?'),
      'summary must not build its own status ternary — delegate to complianceStatusSuffix');
    assert.ok(/complianceSummaryHtml/.test(js), 'summary helper must exist');
  });

  it('distinguishes live "on track" from closed-season "Prize earned!"', () => {
    const js = readJS();
    assert.ok(/on track/i.test(js), 'live qualifying state must say "on track"');
    assert.ok(/Prize earned/.test(js), 'closed qualifying state must say "Prize earned!"');
  });

  it('hides the compliance row when there are no closed attended weeks', () => {
    const js = readJS();
    assert.ok(/compliance\.attended\s*>\s*0/.test(js),
      'row must be hidden when attended is 0 (week 1 has no closed weeks yet)');
  });

  it('shows compliance status in the summary view for closed seasons', () => {
    const js = readJS();
    const idx = js.indexOf("view === 'summary'");
    assert.ok(idx !== -1, 'summary view rendering must exist');
    const window = js.slice(idx, idx + 1200);
    assert.ok(/compliance/.test(window), 'summary view must include the compliance status');
  });

  it('closed-season summary lists the milestone final status', () => {
    const js = readJS();
    assert.ok(/view === 'summary' && res\.milestone/.test(js),
      'summary must render the milestone line when present');
    assert.ok(/Milestone:/.test(js), 'summary milestone line must carry its label');
    assert.ok(/Prize earned/.test(js), 'summary milestone must show the final verdict');
  });

  it('milestone rendering is untouched (regression guard)', () => {
    const js = readJS();
    assert.ok(/res\.milestone/.test(js), 'milestone still driven by res.milestone');
    assert.ok(/milestone\.target/.test(js), 'milestone bar still uses its target');
    assert.ok(!js.includes('res.milestone.target || 4'), 'target must come from the payload only');
  });
});
