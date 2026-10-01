import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const JS_FILE = join(__dirname, '../../../docs/app/app.js');
function readJS() { return readFileSync(JS_FILE, 'utf8'); }

function fnBody(name) {
  const js = readJS();
  const match = js.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`));
  assert.ok(match, `${name} must exist`);
  return match[0];
}

describe('Vote tab vote-state refresh (cross-device sync)', () => {
  it('applyVoteTabRefresh trusts the server alreadySubmitted flag over stale DOM', () => {
    const body = fnBody('applyVoteTabRefresh');
    assert.ok(body.includes('res.alreadySubmitted'),
      'must read the server flag, not only DOM state');
    assert.ok(/typeof res\.alreadySubmitted === 'boolean'[\s\S]*?res\.alreadySubmitted[\s\S]*?domHasVoted/.test(body),
      'when the server reports a boolean, it must override the DOM fallback');
    assert.ok(!/serverVoted \|\| domHasVoted/.test(body),
      'must not OR server and DOM — a stale voted card must not outvote a fresh server "not voted"');
  });

  it('keeps the DOM-derived fallback for already-voted state', () => {
    const body = fnBody('applyVoteTabRefresh');
    assert.ok(/votedCard\.style\.display === 'block'/.test(body),
      'form restore must not clobber the already-voted card state');
    assert.ok(body.includes('domHasVoted'),
      'DOM fallback must remain for responses without a boolean alreadySubmitted');
  });

  it('adopts currentVote from the response and clears it when the server says not voted', () => {
    const body = fnBody('applyVoteTabRefresh');
    assert.ok(body.includes('adoptServerVote(res)'),
      'refresh must delegate vote adoption to the shared helper');
    const helper = fnBody('adoptServerVote');
    assert.ok(helper.includes('typeof res.alreadySubmitted !== \'boolean\''),
      'must ignore adoption when the server did not report vote state');
    assert.ok(/appState\.currentVote = res\.alreadySubmitted && res\.currentVote \? res\.currentVote : null/.test(helper),
      'must store the server-known vote, or null when the server says not voted');
  });

  it('flips a stale submit form to the voted card when the server says voted', () => {
    const body = fnBody('applyVoteTabRefresh');
    assert.ok(body.includes('syncVotedCardView(hasVoted)'),
      'refresh must delegate the voted-card flip');
    const helper = fnBody('syncVotedCardView');
    assert.ok(helper.includes('btn-change-vote'),
      'must show the Change Vote button on flip');
    assert.ok(helper.includes('appState.editingVote'),
      'flip must be gated on the editing guard');
    assert.ok(helper.includes('votedCard.style.display = \'none\''),
      'must hide a stale voted card when the server says not voted');
  });

  it('adopts server week/players before voted-state UI so a voted early path cannot freeze appState.week', () => {
    const body = fnBody('applyVoteTabRefresh');
    const weekIdx = body.indexOf('const weekChanged');
    const syncIdx = body.indexOf('syncVotedCardView(hasVoted)');
    assert.ok(weekIdx !== -1 && syncIdx !== -1, 'both week adoption and voted-card sync must exist');
    assert.ok(weekIdx < syncIdx, 'week/players adoption must run before the voted-card sync');
    assert.ok(body.includes('populateVotingDropdowns(appState.leaders, res.players'),
      'dropdown repopulation must stay in the refresh path');
  });

  it('adopts res.votingOpen so a page booted while voting was closed can recover', () => {
    const body = fnBody('applyVoteTabRefresh');
    assert.ok(body.includes('typeof res.votingOpen === \'boolean\''),
      'must detect a server-reported voting window');
    assert.ok(body.includes('appState.votingOpen = res.votingOpen'),
      'must store fresh voting window state from the response');
  });

  it('changeVote sets the editing guard so a refresh cannot clobber an in-progress edit', () => {
    const body = fnBody('changeVote');
    assert.ok(body.includes('appState.editingVote = true'),
      'changeVote must mark the form as user-edited');
  });

  it('showVoteRecorded clears the editing guard', () => {
    const js = readJS();
    assert.ok(/function showVoteRecorded\([^)]*\) \{[\s\S]*?appState\.editingVote = false;/.test(js),
      'recording a vote (submit or 409 self-heal) must clear the edit guard');
  });

  it('409 self-heal does not stamp the failed form values as the current vote', () => {
    const body = fnBody('submitVotes');
    assert.ok(body.includes('showVoteRecorded(true)'),
      'the already-submitted conflict path must skip the local vote stamp');
    assert.ok(body.includes('refreshVoteTab()'),
      'the conflict path must re-fetch server vote truth');
    assert.ok(/skipVoteStamp[\s\S]*?appState\.currentVote = null/.test(fnBody('showVoteRecorded')),
      'skipVoteStamp must clear currentVote rather than trust the rejected form');
  });

  it('switchTab vote path and the visibility listener share refreshVoteTab', () => {
    const js = readJS();
    assert.ok(/tabId === 'vote-view'[\s\S]{0,600}?refreshVoteTab\(\)/.test(js),
      'switchTab vote-view must call refreshVoteTab');
    assert.ok(/visibilitychange[\s\S]{0,300}?refreshVoteTab\(\)/.test(js),
      'visibilitychange listener must call the same refresh path');
  });

  it('visibilitychange listener guards visibility, link state, and hash — not a stale votingOpen flag', () => {
    const match = readJS().match(/addEventListener\('visibilitychange'[\s\S]{0,400}?\}\);/);
    assert.ok(match, 'visibilitychange listener must exist');
    const body = match[0];
    assert.ok(body.includes("document.visibilityState !== 'visible'"), 'must ignore the hide transition');
    assert.ok(body.includes('appState.linkedPlayer'), 'must require a linked player');
    assert.ok(body.includes("'#vote'"), 'must only refresh while the vote view is shown');
    assert.ok(!body.includes('appState.votingOpen'),
      'must not gate the refresh on boot-time votingOpen — the refresh itself corrects it');
  });

  it('refreshVoteTab ignores out-of-order responses', () => {
    const body = fnBody('refreshVoteTab');
    assert.ok(body.includes('voteTabRefreshSeq'),
      'must track refresh sequence');
    assert.ok(body.includes('seq !== voteTabRefreshSeq'),
      'must drop stale in-flight responses');
  });
});
