/* ============================================================================
 * SWU League Voting — static client (Stage 2)
 * Talks directly to the backend /exec endpoint using per-device session tokens.
 * No Google sign-in, no shared secret: identity is a token minted at link time.
 * ============================================================================ */

// Backend deployment URL (must point at a token-only /exec deployment).
const API_URL = 'https://script.google.com/macros/s/AKfycbwNYQ4BSs6CTIG0KTMXf-e7FyjZhYLSFKOgdnOxYcWm54c4OzNWB0VZ_ltv7fB7wUcH/exec';

// localStorage keys for the per-device session.
const KEY_TOKEN = 'lt_token';
const KEY_DEVICE = 'lt_deviceId';
const KEY_EMAIL = 'lt_email';
const KEY_PLAYER = 'lt_playerId';

// Semantic version of the client build. Bump at every deployment so the deployed
// version is visible in the footer (avoids debugging a stale cache).
const APP_VERSION = '1.0.0';

let appState = {
  status: 'unlinked',
  linkedPlayer: null,
  votingOpen: false,
  settings: {},
  seasons: [],
  leaderboardCache: {},
  myseasonCache: {},
  leaderboardToken: 0,
  myseasonToken: 0
};

/* ---------------------------------------------------------------- session -- */

function getDeviceId() {
  let id = localStorage.getItem(KEY_DEVICE);
  if (!id) {
    id = (crypto.randomUUID
      ? crypto.randomUUID()
      : 'dev-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2));
    localStorage.setItem(KEY_DEVICE, id);
  }
  return id;
}

function getToken() {
  return localStorage.getItem(KEY_TOKEN) || '';
}

function setSession(linkedPlayer, token) {
  localStorage.setItem(KEY_TOKEN, token || '');
  localStorage.setItem(KEY_EMAIL, (linkedPlayer && linkedPlayer.email) || '');
  localStorage.setItem(KEY_PLAYER, (linkedPlayer && linkedPlayer.id) || '');
}

function clearSession() {
  localStorage.removeItem(KEY_TOKEN);
}

function readPrefill() {
  return {
    email: localStorage.getItem(KEY_EMAIL) || '',
    playerId: localStorage.getItem(KEY_PLAYER) || ''
  };
}

/* ------------------------------------------------------------- api layer --- */

async function callApi(action, payload = {}, _isRetry = false) {
  const body = Object.assign({ action: action, token: getToken(), deviceId: getDeviceId() }, payload);
  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      redirect: 'follow'
    });
  } catch (err) {
    throw new Error('Could not connect to the server. Check your connection and try again.');
  }
  let json;
  try {
    json = await res.json();
  } catch (err) {
    // Apps Script web apps return an HTML interstitial on a cold-start redirect
    // BEFORE the real JSON. That body often isn't JSON even though the backend
    // already ran. Reads are idempotent, so we retry them once to ride out the
    // cold start. Writes are NOT auto-resent: a resend could double-execute the
    // write (e.g. minting a second session token or double-submitting), so we
    // surface a retry prompt instead and rely on the app's boot warm-up.
    const isWrite = ['linkAccount', 'unlinkAccount', 'submitVote'].indexOf(action) !== -1;
    if (isWrite) {
      const e = new Error('The server is still warming up. Please click again.');
      e.userMessage = 'The server is still warming up. Please try again.';
      throw e;
    }
    if (!_isRetry) {
      return callApi(action, payload, true);
    }
    throw new Error('The server returned an unexpected response. Please try again.');
  }
  if (!json.success) {
    const e = new Error(json.error || 'Server error.');
    e.userMessage = json.error || '';
    throw e;
  }
  return json.data;
}

/* ------------------------------------------------------------- dom helpers -- */

function $(id) { return document.getElementById(id); }
function showSpinner(show) { $('loading-spinner').style.display = show ? 'block' : 'none'; }
function showStatus(msg, isSuccess) {
  const box = $('status-box');
  box.textContent = msg;
  box.className = 'status-msg ' + (isSuccess ? 'status-success' : 'status-error');
  box.style.display = 'block';
}
function clearStatus() { $('status-box').style.display = 'none'; }

// Show the build version in the footer so we can tell which commit Pages is serving.
function applyVersion() {
  const el = $('site-version');
  if (el) el.textContent = APP_VERSION;
}

// Highlight the given view panel and the matching tab button together.
function setActiveView(viewId, tabIndex) {
  document.querySelectorAll('.view-panel').forEach((v) => v.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
  $(viewId).classList.add('active');
  document.querySelectorAll('.tab-btn')[tabIndex].classList.add('active');
}

/* -------------------------------------------------------------- boot state -- */

function applyBoot(boot) {
  appState.status = boot.status || 'unlinked';
  appState.settings = boot.settings || {};
  appState.linkedPlayer = boot.currentPlayer || boot.linkedPlayer || null;
  appState.votingOpen = Boolean(boot.votingOpen);
  appState.seasons = boot.seasons || [];
  appState.seasonName = boot.seasonName;
  appState.week = boot.week;
  appState.seasonId = boot.seasonId;

  const seasonName = boot.seasonName || ('Season ' + (appState.settings.activeSeasonId || ''));
  $('app-subtitle').textContent = seasonName + ' • Week ' + (boot.week || 1);

  const badge = $('voting-badge');
  badge.style.display = 'inline-block';
  if (boot.votingOpen) {
    badge.textContent = 'Voting Open';
    badge.className = 'badge badge-active';
  } else {
    badge.textContent = 'Voting Closed';
    badge.className = 'badge badge-closed';
  }

  // Season dropdowns (shared across leaderboard + my stats).
  ['season-filter', 'myseason-season-filter'].forEach((id) => {
    const sel = $(id);
    sel.innerHTML = '';
    (boot.seasons || []).forEach((s) => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.name;
      if (String(s.id) === String(boot.seasonId || appState.settings.activeSeasonId)) opt.selected = true;
      sel.appendChild(opt);
    });
  });

  if (boot.status === 'linked') {
    // Reset the vote card to its default visible state before deciding how to
    // present it, so re-entering quickly never leaves a stale hidden form.
    $('vote-form').style.display = '';
    $('already-voted-card').style.display = 'none';
    showLinkedPresence(appState.linkedPlayer);
    showTabs(true);
    setActiveView('vote-view', 0);
    if (boot.alreadySubmitted || boot.alreadyVoted) {
      $('vote-form').style.display = 'none';
      $('already-voted-card').style.display = 'block';
      clearStatus();
    } else if (!appState.votingOpen) {
      $('vote-form').style.display = 'none';
      clearStatus();
      showStatus('Voting is currently closed for this week.', false);
    } else {
      populateVotingDropdowns(boot.leaders, boot.players, appState.linkedPlayer.id);
    }
  } else {
    // unlinked or invalid-token: show the link form, hide the tabs.
    showLinkedPresence(null);
    showTabs(false);
    setActiveView('link-view', 0);
    // Full active roster: returning users re-pick their own player; linkAccount
    // enforces ownership. Default selection restored from this device's memory.
    populateLinkPicker(boot.players || []);
    if (boot.status === 'invalid-token') {
      showStatus('Your session expired. Please re-link to continue.', false);
    }
  }
}

function showTabs(show) {
  const tabs = document.querySelector('.nav-tabs');
  tabs.style.display = show ? 'flex' : 'none';
}

// Global-header identity chip + "Not you?" unlink. Null/empty hides it.
function showLinkedPresence(player) {
  const chip = $('identity-chip');
  if (!player) {
    chip.style.display = 'none';
    return;
  }
  $('chip-name').textContent = player.name;
  chip.style.display = 'flex';
}

function populateLinkPicker(players) {
  const select = $('link-player-select');
  select.innerHTML = '<option value="">-- Choose Your Name --</option>';
  (players || []).forEach((p) => {
    select.appendChild(new Option(p.name, p.id));
  });
  // Restore the last player/email chosen on this device.
  const prefill = readPrefill();
  if (prefill.playerId) select.value = prefill.playerId;
  if (prefill.email) $('link-email').value = prefill.email;
}

/* ---------------------------------------------------------------- intents -- */

function submitAccountLink() {
  const emailEl = $('link-email');
  const email = emailEl.value.trim();
  const playerId = $('link-player-select').value;
  if (!email) { showStatus('Please enter your email address.', false); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showStatus('Please enter a valid email address.', false); return; }
  if (!playerId) { showStatus('Please select your player name.', false); return; }
  showSpinner(true); clearStatus();

  callApi('linkAccount', { playerId: playerId, email: email })
    .then((res) => {
      appState.linkedPlayer = res.linkedPlayer || res.player;
      setSession(appState.linkedPlayer, res.token || '');
      // Render from the authoritative linkAccount response (which already
      // persisted the session + Players col D write server-side) plus the static
      // state carried from the initial getAppData boot. Doing an extra getAppData
      // read right here races Apps Script read-after-write staleness and can
      // report the fresh token as invalid ("session expired"). So we avoid it.
      const boot = {
        status: 'linked',
        votingOpen: res.votingOpen,
        alreadySubmitted: res.alreadyVoted,
        linkedPlayer: res.linkedPlayer || res.player,
        leaders: res.leaders,
        players: res.players,
        settings: appState.settings,
        seasons: appState.seasons,
        seasonName: appState.seasonName,
        week: appState.week,
        seasonId: appState.seasonId
      };
      showSpinner(false);
      applyBoot(boot);
      if (appState.votingOpen) {
        showStatus('Account linked successfully!', true);
      }
    })
    .catch((err) => {
      showSpinner(false);
      showStatus(err.userMessage || err.message || 'Failed to link account.', false);
    });
}

function unlinkCurrentDevice() {
  const name = appState.linkedPlayer ? appState.linkedPlayer.name : '';
  openUnlinkConfirm('Unlink ' + name + '?', 'This device will be disconnected. You can re-link anytime with your email, or pick another player on this device.');
}

function openUnlinkConfirm(title, message) {
  $('unlink-confirm-title').textContent = title;
  $('unlink-confirm-text').textContent = message;
  $('unlink-confirm').style.display = 'flex';
}

function cancelUnlink() {
  $('unlink-confirm').style.display = 'none';
}

function confirmUnlink() {
  $('unlink-confirm').style.display = 'none';
  const token = getToken();
  showSpinner(true); clearStatus();
  callApi('unlinkAccount', { token: token })
    .then(() => {
      showSpinner(false);
      clearSession();
      appState.linkedPlayer = null;
      appState.status = 'unlinked';
      showTabs(false);
      setActiveView('link-view', 0);
      populateLinkPicker([]); // refresh after unlink
      // Re-bootstrap to rebuild the unlinked player list.
      return fetchInitialAppData();
    })
    .catch((err) => {
      showSpinner(false);
      showStatus(err.userMessage || err.message || 'Failed to unlink.', false);
    });
}

function switchTab(tabId) {
  if (tabId === 'vote-view') {
    if (appState.linkedPlayer) { clearStatus(); setActiveView('vote-view', 0); }
    else setActiveView('link-view', 0);
  } else if (tabId === 'leaderboard-view') {
    clearStatus();
    setActiveView('leaderboard-view', 1);
    appState.leaderboardToken++;
    appState.leaderboardCache = {};
    loadLeaderboardData();
  } else if (tabId === 'myseason-view') {
    if (appState.linkedPlayer) {
      clearStatus();
      setActiveView('myseason-view', 2);
      appState.myseasonToken++;
      appState.myseasonCache = {};
      loadMySeasonStats();
    } else {
      setActiveView('link-view', 2);
    }
  }
}

/* ------------------------------------------------------------------ voting -- */

function populateVotingDropdowns(leaders, players, currentUserId) {
  const l1 = $('leader-1');
  const opp = $('favorite-opponent');
  l1.innerHTML = '<option value="">-- Select Leader --</option>';
  opp.innerHTML = '<option value="">-- Select Favorite Opponent --</option>';
  (leaders || []).forEach((l) => l1.appendChild(new Option(l.name, l.id)));
  (players || []).forEach((p) => {
    if (String(p.id) !== String(currentUserId)) opp.appendChild(new Option(p.name, p.id));
  });
}

let voteInFlight = false;

function submitVotes() {
  if (!appState.votingOpen) {
    showStatus('Voting is currently closed for this week.', false);
    return;
  }
  const l1 = $('leader-1').value;
  const opp = $('favorite-opponent').value;
  if (!l1 || !opp) { showStatus('Please select your Leader and Favorite Opponent.', false); return; }
  if (voteInFlight) return;
  voteInFlight = true;
  const btn = $('btn-vote-submit');
  if (btn) btn.disabled = true;
  showSpinner(true); clearStatus();

  function endFlight() {
    voteInFlight = false;
    if (btn) btn.disabled = false;
    showSpinner(false);
  }
  function showVoteRecorded() {
    $('vote-form').style.display = 'none';
    $('already-voted-card').style.display = 'block';
    clearStatus();
    appState.leaderboardCache = {};
  }

  callApi('submitVote', { voteData: { leader1Id: l1, opponentId: opp } })
    .then(() => { endFlight(); showVoteRecorded(); })
    .catch((err) => {
      endFlight();
      const msg = err.userMessage || err.message || '';
      if (msg.includes('already submitted votes for this week')) {
        showVoteRecorded();
      } else {
        showStatus(msg || 'Vote submission failed.', false);
      }
    });
}

/* ----------------------------------------------------------- leaderboard --- */

function loadLeaderboardData() {
  const selectedSeasonId = $('season-filter').value;
  const cached = appState.leaderboardCache[selectedSeasonId];
  if (cached) { renderLeaderboard(cached); return; }

  const token = ++appState.leaderboardToken;
  showSpinner(true);
  callApi('getLeaderboardData', { seasonId: selectedSeasonId })
    .then((res) => {
      if (token !== appState.leaderboardToken) return;
      showSpinner(false);
      appState.leaderboardCache[selectedSeasonId] = res;
      renderLeaderboard(res);
    })
    .catch((err) => {
      if (token !== appState.leaderboardToken) return;
      showSpinner(false);
      showStatus(err.userMessage || err.message || 'Failed to load leaderboard.', false);
    });
}

function renderLeaderboard(res) {
  renderStatsList('most-played-container', res.leaderLeaderboard || [], {
    getTitle: (item) => item.name,
    getScore: (item) => item.score,
    getSubtitle: (item) => item.subtitle
  });
  renderLeaderboardSection('schemer-section', 'schemer-container', res, 'schemer');
  renderLeaderboardSection('ambassador-section', 'ambassador-container', res, 'ambassador');
  renderLeaderboardSection('ruler-section', 'ruler-container', res, 'ruler');
  renderLeaderboardSection('new-hope-section', 'new-hope-container', res, 'newHope');
  renderLeaderboardSection('bounty-hunter-section', 'bounty-hunter-container', res, 'bountyHunter');
  $('leaderboard-content').style.display = 'block';
}

function renderLeaderboardSection(sectionId, containerId, res, field) {
  const section = $(sectionId);
  const items = res[field];
  if (items === null || items === undefined) { section.style.display = 'none'; return; }
  section.style.display = '';
  renderStatsList(containerId, items, {
    getTitle: (item) => item.name,
    getScore: (item) => item.score,
    getSubtitle: (item) => item.subtitle
  });
}

/* --------------------------------------------------------------- my stats -- */

function loadMySeasonStats() {
  if (!appState.linkedPlayer) return;
  const selectedSeasonId = $('myseason-season-filter').value;
  const cached = appState.myseasonCache[selectedSeasonId];
  if (cached) { renderMySeasonStats(cached); return; }

  const token = ++appState.myseasonToken;
  showSpinner(true);
  callApi('getMySeasonStats', { seasonId: selectedSeasonId })
    .then((res) => {
      if (token !== appState.myseasonToken) return;
      showSpinner(false);
      appState.myseasonCache[selectedSeasonId] = res;
      renderMySeasonStats(res);
    })
    .catch((err) => {
      if (token !== appState.myseasonToken) return;
      showSpinner(false);
      showStatus(err.userMessage || err.message || 'Failed to load your stats.', false);
    });
}

function renderMySeasonStats(res) {
  const awardsContainer = $('myseason-awards-container');
  const awardsSection = $('myseason-awards-section');
  const awards = res.awardsWon || [];
  if (awards.length > 0) {
    awardsContainer.innerHTML = awards
      .map((a) => `<div class="card" style="padding:10px 12px; margin-bottom:8px;">
                     <span style="font-weight:700; color:#fbbf24;">Award:</span>
                     <span style="font-weight:700; color:#f8fafc;">${escapeHtml(a)}</span>
                   </div>`)
      .join('');
    awardsSection.style.display = 'block';
  } else {
    awardsContainer.innerHTML = '';
    awardsSection.style.display = 'none';
  }
  renderStatsList('myseason-leaders-container', res.leaders || [], {
    getTitle: (item) => item.name,
    getScore: (item) => `${item.plays} Plays`,
    limit: Infinity
  });
  $('myseason-content').style.display = 'block';
}

/* -------------------------------------------------------------- utilities -- */

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderStatsList(containerId, items, config) {
  const container = $(containerId);
  if (!items || items.length === 0) {
    container.innerHTML = '<div style="text-align:center; color:#94a3b8; padding:12px; font-size: 0.85rem;">No statistics recorded.</div>';
    return;
  }
  const limit = config.limit !== undefined ? config.limit : 3;
  const shown = items.slice(0, limit);
  let html = '<div class="stats-list">';
  shown.forEach((item, i) => {
    const rankNumber = item.displayRank !== undefined ? item.displayRank : (i + 1);
    const title = config.getTitle(item, i);
    const subtitle = config.getSubtitle ? config.getSubtitle(item, i) : null;
    const score = config.getScore(item);
    html += `
      <div class="stats-row rank-${escapeHtml(rankNumber)}">
        <div class="stats-left">
          <div class="rank-pill">#${escapeHtml(rankNumber)}</div>
          <div class="stats-info">
            <span class="stats-title">${escapeHtml(title)}</span>
            ${subtitle ? `<span class="stats-subtitle">${escapeHtml(subtitle)}</span>` : ''}
          </div>
        </div>
        <div class="stats-score">${escapeHtml(score)}</div>
      </div>`;
  });
  html += '</div>';
  container.innerHTML = html;
}

/* ------------------------------------------------------------- boot / init -- */

let bootRetry = true;

async function fetchInitialAppData() {
  showSpinner(true); clearStatus();
  try {
    const boot = await callApi('getAppData', {});
    showSpinner(false);
    applyBoot(boot);
  } catch (err) {
    showSpinner(false);
    if (bootRetry) {
      bootRetry = false;
      setTimeout(fetchInitialAppData, 800);
      return;
    }
    showStatus(err.userMessage || err.message || 'Error connecting to server.', false);
    const retryBtn = $('retry-load');
    if (retryBtn) retryBtn.style.display = 'block';
  }
}

document.addEventListener('DOMContentLoaded', () => { applyVersion(); fetchInitialAppData(); });
