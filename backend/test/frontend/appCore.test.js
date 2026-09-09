import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_DIR = join(__dirname, '../../../docs/app');

function loadCore() {
  const src = readFileSync(join(APP_DIR, 'app-core.js'), 'utf-8');
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  const raw = sandbox.LeagueCore;
  const wrapped = {};
  for (const [name, value] of Object.entries(raw)) {
    if (typeof value === 'function') {
      wrapped[name] = (...args) => {
        const result = value(...args);
        return result === undefined ? undefined : structuredClone(result);
      };
    } else {
      wrapped[name] = value;
    }
  }
  return wrapped;
}

const core = loadCore();

describe('frontend/app-core', () => {
  it('core is DOM-free and side-effect-free (testable in a bare sandbox)', () => {
    const src = readFileSync(join(APP_DIR, 'app-core.js'), 'utf-8');
    assert.ok(!/\bdocument\b|\bwindow\b|\blocalStorage\b/.test(src), 'app-core.js must not touch DOM globals');
    assert.equal(typeof core.mapSettings, 'function');
    assert.equal(typeof core.computeSubtitle, 'function');
    assert.equal(typeof core.isFreshCache, 'function');
    assert.equal(typeof core.resolvePlayerChoices, 'function');
    assert.equal(typeof core.leaderOptionLabel, 'function');
  });

  describe('leaderOptionLabel', () => {
    it('joins name and set with a hyphen', () => {
      assert.equal(core.leaderOptionLabel({ name: 'Admiral Ackbar', set: 'JTL' }), 'Admiral Ackbar - JTL');
    });

    it('plain name when set is missing', () => {
      assert.equal(core.leaderOptionLabel({ name: 'Yoda', set: null }), 'Yoda');
      assert.equal(core.leaderOptionLabel({ name: 'Yoda' }), 'Yoda');
    });

    it('empty for null leader', () => {
      assert.equal(core.leaderOptionLabel(null), '');
    });
  });

  describe('mapSettings (R7: backend sends UPPER_SNAKE keys)', () => {
    it('maps WEEKLY_DEADLINE_DAY/TIME and TIMEZONE to camelCase', () => {
      const mapped = core.mapSettings({
        WEEKLY_DEADLINE_DAY: 'Wednesday',
        WEEKLY_DEADLINE_TIME: '17:45',
        TIMEZONE: 'Europe/Stockholm',
      });
      assert.equal(mapped.weeklyDeadlineDay, 'Wednesday');
      assert.equal(mapped.weeklyDeadlineTime, '17:45');
      assert.equal(mapped.timezone, 'Europe/Stockholm');
    });

    it('passes through already-camelCase keys (backward compat)', () => {
      const mapped = core.mapSettings({ weeklyDeadlineDay: 'Thursday', weeklyDeadlineTime: '18:00' });
      assert.equal(mapped.weeklyDeadlineDay, 'Thursday');
      assert.equal(mapped.weeklyDeadlineTime, '18:00');
    });

    it('returns empty strings for missing settings', () => {
      assert.deepEqual(core.mapSettings(undefined), { weeklyDeadlineDay: '', weeklyDeadlineTime: '', timezone: '' });
      assert.deepEqual(core.mapSettings({}), { weeklyDeadlineDay: '', weeklyDeadlineTime: '', timezone: '' });
    });
  });

  describe('computeSubtitle (R9: Season Ended was unreachable)', () => {
    it('renders week for live season', () => {
      assert.equal(core.computeSubtitle({ seasonName: 'Season 7', week: 3 }), 'Season 7 • Week 3');
    });

    it('renders Season Ended when week is null', () => {
      assert.equal(core.computeSubtitle({ seasonName: 'Season 6', week: null }), 'Season 6 — Season Ended');
    });

    it('renders empty subtitle when no season name', () => {
      assert.equal(core.computeSubtitle({ seasonName: null, week: 2 }), '');
      assert.equal(core.computeSubtitle({}), '');
      assert.equal(core.computeSubtitle(null), '');
    });
  });

  describe('isFreshCache', () => {
    it('fresh within TTL', () => {
      const cache = { s6: { ts: 1000, data: {} } };
      assert.equal(core.isFreshCache(cache, 's6', 1000 + core.CACHE_TTL_MS - 1), true);
    });

    it('stale at or past TTL', () => {
      const cache = { s6: { ts: 1000, data: {} } };
      assert.equal(core.isFreshCache(cache, 's6', 1000 + core.CACHE_TTL_MS), false);
    });

    it('missing key or cache is never fresh', () => {
      assert.equal(core.isFreshCache({}, 's6', Date.now()), false);
      assert.equal(core.isFreshCache(null, 's6', Date.now()), false);
    });
  });

  describe('resolvePlayerChoices (CONTEXT: all roster players are shown in the link picker)', () => {
    it('uses the full players roster', () => {
      const boot = { players: [{ id: 'P001', name: 'Alice' }, { id: 'P003', name: 'Charlie' }], unlinkedPlayers: [{ id: 'P004', name: 'Diana' }] };
      assert.equal(core.resolvePlayerChoices(boot).length, 2);
      assert.equal(core.resolvePlayerChoices(boot)[0].id, 'P001');
    });

    it('falls back to unlinkedPlayers when roster missing', () => {
      const boot = { unlinkedPlayers: [{ id: 'P004', name: 'Diana' }] };
      assert.deepEqual(core.resolvePlayerChoices(boot), [{ id: 'P004', name: 'Diana' }]);
    });

    it('missing everything returns empty list', () => {
      assert.deepEqual(core.resolvePlayerChoices({}), []);
      assert.deepEqual(core.resolvePlayerChoices(null), []);
    });
  });

  describe('gamificationViewFor (historical vs live season display)', () => {
    it('active season always gets the full view, even before any votes', () => {
      assert.equal(core.gamificationViewFor(true, false), 'full');
      assert.equal(core.gamificationViewFor(true, true), 'full');
    });

    it('closed season with vote data gets summary', () => {
      assert.equal(core.gamificationViewFor(false, true), 'summary');
    });

    it('closed pre-voting era season is hidden, not zeroed', () => {
      assert.equal(core.gamificationViewFor(false, false), 'hidden');
    });
  });

  describe('vote action selection across week boundaries', () => {
    it('picks updateVote only when a current vote is held', () => {
      assert.equal(core.voteSubmitAction(null), 'submitVote');
      assert.equal(core.voteSubmitAction(undefined), 'submitVote');
      assert.equal(core.voteSubmitAction({ leaderId: '1', opponentId: 'P002' }), 'updateVote');
    });

    it('retries once as new vote when the stale tab gets 404 after week advance', () => {
      assert.equal(core.shouldRetryAsNewVote('No vote to update. Use submitVote instead.', false), true);
      assert.equal(core.shouldRetryAsNewVote('No vote to update. Use submitVote instead.', true), false, 'single retry only');
      assert.equal(core.shouldRetryAsNewVote('Voting is currently closed for this week.', false), false);
      assert.equal(core.shouldRetryAsNewVote(null, false), false);
    });
  });
});

describe('frontend wiring', () => {
  const html = readFileSync(join(APP_DIR, 'index.html'), 'utf-8');
  const app = readFileSync(join(APP_DIR, 'app.js'), 'utf-8');

  it('index.html loads app-core.js before app.js', () => {
    const corePos = html.indexOf('app-core.js');
    const appPos = html.indexOf('<script src="app.js">');
    assert.ok(corePos > -1, 'app-core.js script tag present');
    assert.ok(appPos > -1, 'app.js script tag present');
    assert.ok(corePos < appPos, 'core loads first');
  });

  it('app.js consumes LeagueCore and no longer compares week to the never-sent Season Ended string', () => {
    assert.ok(app.includes('LeagueCore.'), 'app.js wired to core');
    assert.ok(!app.includes("=== 'Season Ended'"), 'stale season-ended comparison removed (R9)');
  });

  it('confirmUnlink resets its reentrancy flag in the success path (R8)', () => {
    assert.match(app, /callApi\('unlinkAccount'[\s\S]{0,250}?unlinkInFlight = false;/);
  });

  it('deadline banner reads camelCase settings that mapSettings produces (R7)', () => {
    assert.match(app, /appState\.settings\.weeklyDeadlineDay/);
    assert.match(app, /LeagueCore\.mapSettings/);
  });

  it('compliance is fully retired from the client and view mode is wired', () => {
    assert.ok(!/compliance/i.test(app), 'app.js must not reference compliance');
    assert.ok(!/compliance/i.test(html), 'index.html must not reference compliance');
    assert.match(app, /LeagueCore\.gamificationViewFor/);
  });

  it('standings name resolution uses the full roster, leader dropdown uses set labels', () => {
    assert.match(app, /appState\.roster = boot\.roster \|\| boot\.players/);
    assert.match(app, /LeagueCore\.leaderOptionLabel/);
    assert.ok(!/new Option\(l\.name, l\.id\)/.test(app), 'no bare-name leader options left');
  });

  it('link view exposes the pick/email dual mode for multi-device relinking', () => {
    assert.ok(html.includes('id="link-picker-group"'), 'picker group wraps name search+select');
    assert.ok(html.includes('id="link-mode-toggle"'), 'toggle button present');
    assert.ok(html.includes('id="link-email-hint"'), 'email-mode hint present');
    assert.match(app, /function toggleLinkMode\(/);
    assert.match(app, /setLinkMode\('pick'\)/, 'picker is always the default, even with remembered email');
    assert.match(app, /linkMode === 'email' \? '' :/);
  });
});
