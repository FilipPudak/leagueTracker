/* ============================================================================
 * SWU League Voting — static client (Stage 2)
 * Talks directly to the backend /exec endpoint using per-device session tokens.
 * No Google sign-in, no shared secret: identity is a token minted at link time.
 * ============================================================================ */

// Backend deployment URL (Cloudflare Worker with D1 database).
const API_URL = 'https://league-tracker.filip-pudak.workers.dev';

// localStorage keys for the per-device session.
const KEY_TOKEN = 'lt_token';
const KEY_DEVICE = 'lt_deviceId';
const KEY_EMAIL = 'lt_email';
const KEY_PLAYER = 'lt_playerId';

// Semantic version of the client build. Bump at every deployment so the deployed
// version is visible in the footer (avoids debugging a stale cache).
const APP_VERSION = '2.0.0';

// How long a loaded leaderboard/stats payload stays fresh before a re-entry
// refetches it. Flicking between tabs is sub-second, so a tiny TTL is enough to
// avoid refetch-spam (and repeated slow SWU standings fetches) while genuine
// returns still get fresh data. Value is seconds.
const CACHE_TTL_SECONDS = 15;

let appState = {
  status: 'unlinked',
  linkedPlayer: null,
  votingOpen: false,
  settings: {},
  seasons: [],
  leaderboardCache: {},
  mystatsCache: {},
  leaderboardToken: 0,
  mystatsToken: 0,
  leaderboardInFlight: false,
  leaderboardInFlightSeason: null,
  mystatsInFlight: false,
  mystatsInFlightSeason: null,
  lastView: 'vote-view'
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

// FIX: Wipe email and player memory on unlink to prevent account prefill leakage
function clearSession() {
  localStorage.removeItem(KEY_TOKEN);
  localStorage.removeItem(KEY_EMAIL);
  localStorage.removeItem(KEY_PLAYER);
}

function readPrefill() {
  return {
    email: localStorage.getItem(KEY_EMAIL) || '',
    playerId: localStorage.getItem(KEY_PLAYER) || ''
  };
}

/* ------------------------------------------------------------- api layer --- */

const IDEMPOTENT_WRITES = ['linkAccount', 'unlinkAccount'];

async function callApi(action, payload = {}, _attempt = 0) {
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
    const isIdempotent = IDEMPOTENT_WRITES.indexOf(action) !== -1;
    const isVote = action === 'submitVote';

    if (isVote) {
      const e = new Error('The server is still warming up. Please click again.');
      e.userMessage = 'The server is still warming up. Please try again.';
      throw e;
    }

    // FIX: Add exponential backoff delay before retrying warm-up requests
    if (isIdempotent) {
      if (_attempt < 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return callApi(action, payload, _attempt + 1);
      }
      const e = new Error('The server is still warming up. Please click again.');
      e.userMessage = 'The server is still warming up. Please try again.';
      throw e;
    }

    if (_attempt === 0) {
      await new Promise((resolve) => setTimeout(resolve, 800));
      return callApi(action, payload, 1);
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

let spinnerOwner = null;

// FIX: Always allow force-clearing or resetting the spinner owner state safely
function showSpinner(show, owner) {
  if (show) {
    spinnerOwner = owner;
  } else {
    if (owner && owner !== spinnerOwner) return; // a stale owner can't clear an active owner's spinner
  }
  const el = $('loading-spinner');
  if (el) el.style.display = show ? 'block' : 'none';
  if (!show) spinnerOwner = null;
}

function showStatus(msg, isSuccess) {
  const box = $('status-box');
  if (!box) return;
  box.textContent = msg;
  box.className = 'status-msg ' + (isSuccess ? 'status-success' : 'status-error');
  box.style.display = 'block';
}

function clearStatus() {
  const box = $('status-box');
  if (box) box.style.display = 'none';
}

function applyVersion() {
  const el = $('site-version');
  if (el) el.textContent = APP_VERSION;
}

function setActiveView(viewId, tabIndex) {
  document.querySelectorAll('.view-panel').forEach((v) => v.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
  const viewEl = $(viewId);
  if (viewEl) viewEl.classList.add('active');
  const tabs = document.querySelectorAll('.tab-btn');
  if (tabs[tabIndex]) tabs[tabIndex].classList.add('active');
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
  const subtitleEl = $('app-subtitle');
  if (subtitleEl) subtitleEl.textContent = seasonName + ' • Week ' + (boot.week || 1);

  const badge = $('voting-badge');
  if (badge) {
    badge.style.display = 'inline-block';
    if (boot.votingOpen) {
      badge.textContent = 'Voting Open';
      badge.className = 'badge badge-active';
    } else {
      badge.textContent = 'Voting Closed';
      badge.className = 'badge badge-closed';
    }
  }

  ['season-filter', 'myseason-season-filter'].forEach((id) => {
    const sel = $(id);
    if (!sel) return;
    sel.innerHTML = '';
    (boot.seasons || []).forEach((s) => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.name;
      if (String(s.id) === String(boot.seasonId || appState.settings.activeSeasonId)) opt.selected = true;
      sel.appendChild(opt);
    });
  });

  const wpCard = $('weekly-participation-card');
  const wpText = $('weekly-participation-text');
  if (wpCard && wpText) {
    if (boot.weeklyParticipation && boot.weeklyParticipation.total > 0) {
      wpText.textContent = boot.weeklyParticipation.voted + ' of ' + boot.weeklyParticipation.total + ' players have voted this week';
      wpCard.style.display = 'block';
    } else {
      wpCard.style.display = 'none';
    }
  }

  if (boot.status === 'linked') {
    const voteForm = $('vote-form');
    const votedCard = $('already-voted-card');
    if (voteForm) voteForm.style.display = '';
    if (votedCard) votedCard.style.display = 'none';

    showLinkedPresence(appState.linkedPlayer);
    showTabs(true);
    setActiveView('vote-view', 0);

    if (boot.alreadySubmitted || boot.alreadyVoted) {
      if (voteForm) voteForm.style.display = 'none';
      if (votedCard) votedCard.style.display = 'block';
      clearStatus();
    } else if (!appState.votingOpen) {
      if (voteForm) voteForm.style.display = 'none';
      clearStatus();
      showStatus('Voting is currently closed for this week.', false);
    } else {
      populateVotingDropdowns(boot.leaders, boot.players, appState.linkedPlayer.id);
    }
  } else {
    showLinkedPresence(null);
    showTabs(false);
    setActiveView('link-view', 0);
    populateLinkPicker(boot.players || []);
    if (boot.status === 'invalid-token') {
      showStatus('Your session expired. Please re-link to continue.', false);
    }
  }
}

function showTabs(show) {
  const tabs = document.querySelector('.nav-tabs');
  if (tabs) tabs.style.display = show ? 'flex' : 'none';
}

function showLinkedPresence(player) {
  const chip = $('identity-chip');
  if (!chip) return;
  if (!player) {
    chip.style.display = 'none';
    return;
  }
  const chipName = $('chip-name');
  if (chipName) chipName.textContent = player.name;
  chip.style.display = 'flex';
}

function populateLinkPicker(players) {
  const select = $('link-player-select');
  if (!select) return;
  select.innerHTML = '<option value="">-- Choose Your Name --</option>';
  (players || []).forEach((p) => {
    select.appendChild(new Option(p.name, p.id));
  });
  const prefill = readPrefill();
  if (prefill.playerId) select.value = prefill.playerId;
  const emailEl = $('link-email');
  if (prefill.email && emailEl) emailEl.value = prefill.email;
}

/* ---------------------------------------------------------------- intents -- */

let linkInFlight = false;

function submitAccountLink() {
  if (linkInFlight) return;
  const emailEl = $('link-email');
  const email = emailEl ? emailEl.value.trim() : '';
  const selectEl = $('link-player-select');
  const playerId = selectEl ? selectEl.value : '';

  if (!email) { showStatus('Please enter your email address.', false); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showStatus('Please enter a valid email address.', false); return; }
  if (!playerId) { showStatus('Please select your player name.', false); return; }

  linkInFlight = true;
  showSpinner(true, 'link'); clearStatus();

  callApi('linkAccount', { playerId: playerId, email: email })
    .then((res) => {
      appState.linkedPlayer = res.linkedPlayer || res.player;
      setSession(appState.linkedPlayer, res.token || '');

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
      linkInFlight = false;
      applyBoot(boot);
      if (appState.votingOpen) {
        showStatus('Account linked successfully!', true);
      }
    })
    .catch((err) => {
      showSpinner(false);
      linkInFlight = false;
      showStatus(err.userMessage || err.message || 'Failed to link account.', false);
    });
}

function unlinkCurrentDevice() {
  const name = appState.linkedPlayer ? appState.linkedPlayer.name : '';
  openUnlinkConfirm('Unlink ' + name + '?', 'This device will be disconnected. You can re-link anytime with your email, or pick another player on this device.');
}

function openUnlinkConfirm(title, message) {
  const tEl = $('unlink-confirm-title');
  const msgEl = $('unlink-confirm-text');
  const overlay = $('unlink-confirm');
  if (tEl) tEl.textContent = title;
  if (msgEl) msgEl.textContent = message;
  if (overlay) overlay.style.display = 'flex';
}

function cancelUnlink() {
  const overlay = $('unlink-confirm');
  if (overlay) overlay.style.display = 'none';
}

const TAB_INDEX = { 'vote-view': 0, 'leaderboard-view': 1, 'myseason-view': 2 };

function confirmUnlink() {
  cancelUnlink();
  const lastView = appState.lastView;
  showTabs(false);
  showLinkedPresence(null);
  clearStatus();
  showStatus('Unlinking…', false);
  showSpinner(true, 'unlink');
  const token = getToken();

  callApi('unlinkAccount', { token: token })
    .then(() => {
      clearSession();
      appState.linkedPlayer = null;
      appState.status = 'unlinked';
      return fetchInitialAppData();
    })
    .catch((err) => {
      showSpinner(false);
      showStatus(err.userMessage || err.message || 'Failed to unlink.', false);
      if (appState.linkedPlayer) {
        showTabs(true);
        showLinkedPresence(appState.linkedPlayer);
        setActiveView(lastView, TAB_INDEX[lastView] || 0);
      }
    });
}

function switchTab(tabId) {
  if (tabId === 'vote-view') {
    if (appState.linkedPlayer) {
      clearStatus();
      showSpinner(false);
      setActiveView('vote-view', 0);
      const votedCard = $('already-voted-card');
      if (!appState.votingOpen && votedCard && votedCard.style.display !== 'block') {
        showStatus('Voting is currently closed for this week.', false);
      }
    } else {
      document.querySelectorAll('.view-panel').forEach((v) => v.classList.remove('active'));
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      const linkView = $('link-view');
      if (linkView) linkView.classList.add('active');
    }
  } else if (tabId === 'leaderboard-view') {
    clearStatus();
    showSpinner(false);
    setActiveView('leaderboard-view', 1);
    appState.lastView = 'leaderboard-view';
    loadLeaderboardData();
  } else if (tabId === 'myseason-view') {
    if (appState.linkedPlayer) {
      clearStatus();
      showSpinner(false);
      setActiveView('myseason-view', 2);
      appState.lastView = 'myseason-view';
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
  if (!l1 || !opp) return;
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
  const l1El = $('leader-1');
  const oppEl = $('favorite-opponent');
  const l1 = l1El ? l1El.value : '';
  const opp = oppEl ? oppEl.value : '';

  if (!l1 || !opp) { showStatus('Please select your Leader and Favorite Opponent.', false); return; }
  if (voteInFlight) return;
  voteInFlight = true;
  const btn = $('btn-vote-submit');
  if (btn) btn.disabled = true;
  showSpinner(true, 'vote'); clearStatus();

  function endFlight() {
    voteInFlight = false;
    if (btn) btn.disabled = false;
    showSpinner(false, 'vote');
  }
  function showVoteRecorded() {
    const vForm = $('vote-form');
    const vCard = $('already-voted-card');
    if (vForm) vForm.style.display = 'none';
    if (vCard) vCard.style.display = 'block';
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
  const sel = $('season-filter');
  const selectedSeasonId = sel ? sel.value : '';
  if (isFreshCache(appState.leaderboardCache, selectedSeasonId)) {
    renderLeaderboard(appState.leaderboardCache[selectedSeasonId].data);
    return;
  }

  if (appState.leaderboardInFlight && appState.leaderboardInFlightSeason === selectedSeasonId) {
    showSpinner(true, 'leaderboard');
    return;
  }

  const token = ++appState.leaderboardToken;
  appState.leaderboardInFlight = true;
  appState.leaderboardInFlightSeason = selectedSeasonId;
  showSpinner(true, 'leaderboard');

  callApi('getLeaderboardData', { seasonId: selectedSeasonId })
    .then((res) => {
      if (token !== appState.leaderboardToken) return;
      appState.leaderboardInFlight = false;
      appState.leaderboardInFlightSeason = null;
      showSpinner(false, 'leaderboard');
      appState.leaderboardCache[selectedSeasonId] = { data: res, ts: Date.now() };
      renderLeaderboard(res);
    })
    .catch((err) => {
      if (token !== appState.leaderboardToken) return;
      appState.leaderboardInFlight = false;
      appState.leaderboardInFlightSeason = null;
      showSpinner(false, 'leaderboard');
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
  const content = $('leaderboard-content');
  if (content) content.style.display = 'block';
}

function renderLeaderboardSection(sectionId, containerId, res, field) {
  const section = $(sectionId);
  if (!section) return;
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
  const sel = $('myseason-season-filter');
  const selectedSeasonId = sel ? sel.value : '';
  if (isFreshCache(appState.mystatsCache, selectedSeasonId)) {
    renderMySeasonStats(appState.mystatsCache[selectedSeasonId].data);
    return;
  }

  if (appState.mystatsInFlight && appState.mystatsInFlightSeason === selectedSeasonId) {
    showSpinner(true, 'mystats');
    return;
  }

  const token = ++appState.mystatsToken;
  appState.mystatsInFlight = true;
  appState.mystatsInFlightSeason = selectedSeasonId;
  showSpinner(true, 'mystats');

  callApi('getMySeasonStats', { seasonId: selectedSeasonId })
    .then((res) => {
      if (token !== appState.mystatsToken) return;
      appState.mystatsInFlight = false;
      appState.mystatsInFlightSeason = null;
      showSpinner(false, 'mystats');
      appState.mystatsCache[selectedSeasonId] = { data: res, ts: Date.now() };
      renderMySeasonStats(res);
    })
    .catch((err) => {
      if (token !== appState.mystatsToken) return;
      appState.mystatsInFlight = false;
      appState.mystatsInFlightSeason = null;
      showSpinner(false, 'mystats');
      showStatus(err.userMessage || err.message || 'Failed to load your stats.', false);
    });
}

function renderMySeasonStats(res) {
  const gamSection = $('myseason-gamification-section');
  const gamContainer = $('myseason-gamification-container');
  const compliance = res.compliance || {};
  const streaks = res.streaks || {};
  const raffle = res.raffleTickets || 0;

  if (gamSection && gamContainer) {
    if (compliance.weeksAttended > 0 || raffle > 0) {
      let html = '';
      if (compliance.weeksAttended > 0) {
        html += `<div><span style="color:#94a3b8;">Compliance:</span> <strong>${escapeHtml(compliance.weeksVoted)} of ${escapeHtml(compliance.weeksAttended)} weeks (${escapeHtml(compliance.compliancePct)}%)</strong></div>`;
      }
      // FIX: Corrected mismatched tag from </span> to </strong>
      if (streaks.currentStreak > 0 || streaks.bestStreak > 0) {
        html += `<div><span style="color:#94a3b8;">Streak:</span> <strong>${escapeHtml(streaks.currentStreak)} current</strong> &bull; <strong>${escapeHtml(streaks.bestStreak)} best</strong></div>`;
      }
      if (raffle > 0) {
        html += `<div><span style="color:#94a3b8;">Raffle tickets:</span> <strong style="color:#fbbf24;">${escapeHtml(raffle)}</strong></div>`;
      }
      gamContainer.innerHTML = html;
      gamSection.style.display = 'block';
    } else {
      gamSection.style.display = 'none';
    }
  }

  const awardsContainer = $('myseason-awards-container');
  const awardsSection = $('myseason-awards-section');
  const awards = res.awardsWon || [];
  if (awardsContainer && awardsSection) {
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
  }

  renderStatsList('myseason-leaders-container', res.leaders || [], {
    getTitle: (item) => item.name,
    getScore: (item) => `${item.plays} Plays`,
    limit: Infinity
  });

  const content = $('myseason-content');
  if (content) content.style.display = 'block';
}

/* -------------------------------------------------------------- utilities -- */

function isFreshCache(viewCache, seasonId) {
  const entry = viewCache[seasonId];
  if (!entry) return false;
  return (Date.now() - entry.ts) < (CACHE_TTL_SECONDS * 1000);
}

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
  if (!container) return;
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
  appState.leaderboardInFlight = false;
  appState.leaderboardInFlightSeason = null;
  appState.mystatsInFlight = false;
  appState.mystatsInFlightSeason = null;
  appState.leaderboardToken = 0;
  appState.mystatsToken = 0;
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