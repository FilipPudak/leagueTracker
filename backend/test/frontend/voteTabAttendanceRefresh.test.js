import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const JS_FILE = join(__dirname, '../../../docs/app/app.js');
function readJS() { return readFileSync(JS_FILE, 'utf8'); }

function refreshFnBody() {
  const js = readJS();
  const match = js.match(/function applyVoteTabRefresh\(res\) \{[\s\S]*?\n\}/);
  assert.ok(match, 'applyVoteTabRefresh must exist');
  return match[0];
}

describe('Vote tab attendance refresh (applyVoteTabRefresh)', () => {
  it('is wired into the vote-tab getWeeklyParticipation response', () => {
    const js = readJS();
    const block = js.match(/callApi\('getWeeklyParticipation'[\s\S]*?\.catch\(\(\) => \{\}\);/);
    assert.ok(block, 'vote tab must call getWeeklyParticipation');
    assert.ok(block[0].includes('applyVoteTabRefresh(res)'),
      'attended must be refreshed per tab switch, not frozen at boot');
  });

  it('updates appState.attended from the response', () => {
    const body = refreshFnBody();
    assert.ok(body.includes('appState.attended = res.attended'),
      'must store fresh attended state from the authoritative response');
  });

  it('keeps the standings-tab vote CTA in sync with fresh attendance', () => {
    const body = refreshFnBody();
    assert.ok(body.includes('shouldShowVoteCta'),
      'vote-CTA visibility must be recomputed per refresh, never stale');
    assert.ok(body.includes('vote-cta'), 'must target the vote-cta element');
  });

  it('shows the not-attended card and hides the form when attended is false', () => {
    const body = refreshFnBody();
    assert.ok(body.includes('not-attended-card'), 'must render attendance state');
    assert.ok(/res\.attended === false[\s\S]*?voteForm/.test(body),
      'must hide the form for non-attendees');
  });

  it('re-populates opponent dropdowns when the week changed or filter appeared', () => {
    const body = refreshFnBody();
    assert.ok(body.includes('weekChanged'), 'must guard against wiping in-progress selections');
    assert.ok(body.includes('populateVotingDropdowns(appState.leaders, res.players'),
      'must refresh dropdowns from the response');
  });

  it('respects already-voted state when restoring the form', () => {
    const body = refreshFnBody();
    assert.ok(/votedCard\.style\.display === 'block'/.test(body),
      'form restore must not clobber the already-voted card state');
  });

  it('keeps boot-time attended wiring for initial render', () => {
    const js = readJS();
    assert.ok(js.includes('appState.attended = boot.attended'),
      'applyBoot must still seed attended to avoid a form flash before first fetch');
  });
});
