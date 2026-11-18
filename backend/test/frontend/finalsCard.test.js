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

describe('career finals card (index.html)', () => {
  it('sits below the season progression card in the record tab', () => {
    const html = readHTML();
    const tab = html.indexOf('id="career-tab-record"');
    const progression = html.indexOf('id="career-progression-card"');
    const finals = html.indexOf('id="career-finals-card"');
    assert.ok(tab !== -1, 'record tab must exist');
    assert.ok(progression > tab, 'progression card must live in the record tab');
    assert.ok(finals > progression, 'finals card must follow the progression card');
  });
});

describe('career finals card (app.js)', () => {
  it('tolerates a backend payload without finals', () => {
    const js = readJS();
    assert.ok(
      js.includes('function renderFinalsCard(card, finals)'),
      'renderFinalsCard must take the finals payload'
    );
    assert.match(
      js,
      /function renderFinalsCard\(card, finals\) \{\s*const hasFinals = Boolean\(finals && \(finals\.nights/,
      'a missing finals field must short-circuit instead of throwing'
    );
  });

  it('shows best finish rather than first-place nights', () => {
    const js = readJS();
    const start = js.indexOf('function careerFinalsHtml');
    assert.ok(start !== -1, 'careerFinalsHtml must exist');
    const block = js.slice(start, js.indexOf('function renderFinalsCard', start));
    assert.ok(block.includes('Best finish'), 'the card must show best finish');
    assert.ok(block.includes('bestFinish'), 'best finish must come from the payload');
    assert.ok(!/1st/i.test(block), 'no 1st-place-nights tile');
    assert.ok(!block.includes('lossless'), 'no lossless-nights tile');
  });

  it('escapes every interpolated finals value', () => {
    const js = readJS();
    const start = js.indexOf('function careerFinalsHtml');
    const block = js.slice(start, js.indexOf('function renderFinalsCard', start));
    const interpolations = block.match(/\$\{[^}]+\}/g) || [];
    assert.ok(interpolations.length > 0, 'the card must interpolate values');
    for (const expr of interpolations) {
      assert.ok(expr.includes('escapeHtml('), `unescaped interpolation: ${expr}`);
    }
  });

  it('formats placings with an ordinal suffix helper', () => {
    const js = readJS();
    assert.match(
      js,
      /function ordinal\(n\) \{\s*const suffix = \['th', 'st', 'nd', 'rd'\];/,
      'ordinal helper must exist'
    );
  });
});
