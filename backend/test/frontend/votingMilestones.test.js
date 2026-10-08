import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const JS_FILE = join(__dirname, '../../../docs/app/app.js');
const HTML_FILE = join(__dirname, '../../../docs/app/index.html');

function readJS() { return readFileSync(JS_FILE, 'utf8'); }
function readHTML() { return readFileSync(HTML_FILE, 'utf8'); }

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

  it('reward copy states the 80% season-end rule', () => {
    const html = readHTML();
    const reward = html.match(/id="compliance-reward"[^>]*>([^<]+)</);
    assert.ok(reward, 'compliance-reward copy must exist');
    assert.ok(reward[1].includes('80%'), 'copy must mention 80%');
    assert.ok(/season end/i.test(reward[1]), 'copy must mention the season-end prize');
  });

  it('milestone reward copy is untouched', () => {
    const html = readHTML();
    assert.ok(html.includes('4 votes earns you a prize'), 'milestone copy must stay');
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

  it('shows the ratio percentage and the 80% requirement', () => {
    const js = readJS();
    assert.ok(/need 80%/.test(js), 'non-qualifying state must show "need 80%"');
    assert.ok(/compliance\.pct/.test(js), 'bar text must include the computed pct');
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

  it('milestone rendering is untouched (regression guard)', () => {
    const js = readJS();
    assert.ok(/res\.milestone/.test(js), 'milestone still driven by res.milestone');
    assert.ok(/milestone\.target/.test(js), 'milestone bar still uses its target');
  });
});
