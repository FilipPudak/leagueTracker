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
const APP_VERSION = '4.0.16';

let appState = {
  status: 'unlinked',
  linkedPlayer: null,
  votingOpen: false,
  settings: {},
  seasons: [],
  leaderboardCache: {},
  mystatsCache: {},
  standingsCache: {},
  leaderboardToken: 0,
  mystatsToken: 0,
  standingsToken: 0,
  leaderboardInFlight: false,
  leaderboardInFlightSeason: null,
  mystatsInFlight: false,
  mystatsInFlightSeason: null,
  careerCache: {},
  careerInFlight: false,
  standingsInFlight: false,
  standingsInFlightSeason: null,
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
      headers: { 'Content-Type': 'application/json' },
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
  appState.settings = LeagueCore.mapSettings(boot.settings);
  appState.linkedPlayer = boot.currentPlayer || boot.linkedPlayer || null;
  appState.votingOpen = Boolean(boot.votingOpen);
  appState.seasons = boot.seasons || [];
  appState.players = boot.players || [];
  appState.roster = boot.roster || boot.players || [];
  appState.currentVote = boot.currentVote || null;
  appState.seasonName = boot.seasonName;
  appState.week = boot.week;
  appState.seasonId = boot.seasonId;
  appState.leaders = boot.leaders || [];

  const subtitleEl = $('app-subtitle');
  if (subtitleEl) subtitleEl.textContent = LeagueCore.computeSubtitle(boot);

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

  ['season-filter', 'myseason-season-filter', 'standings-season-filter'].forEach((id) => {
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

  const deadlineCard = $('deadline-copy');
  const deadlineText = $('deadline-text');
  if (deadlineCard && deadlineText) {
    const day = appState.settings.weeklyDeadlineDay;
    const time = appState.settings.weeklyDeadlineTime;
    if (day && time) {
      deadlineText.textContent = 'Voting open until next Wednesday\'s games end';
      deadlineCard.style.display = appState.votingOpen ? 'block' : 'none';
    } else {
      deadlineCard.style.display = 'none';
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

    if (appState.votingOpen) {
      populateVotingDropdowns(boot.leaders, boot.players, appState.linkedPlayer.id);
    }
    if (boot.alreadySubmitted || boot.alreadyVoted) {
      if (voteForm) voteForm.style.display = 'none';
      if (votedCard) votedCard.style.display = 'block';
      const changeBtn = $('btn-change-vote');
      if (changeBtn) changeBtn.style.display = appState.votingOpen ? 'inline-block' : 'none';
      clearStatus();
    } else if (!appState.votingOpen) {
      if (voteForm) voteForm.style.display = 'none';
      clearStatus();
      showStatus('Voting is currently closed for this week.', false);
    }
  } else {
    showLinkedPresence(null);
    showTabs(false);
    setActiveView('link-view', 0);
    populateLinkPicker(LeagueCore.resolvePlayerChoices(boot));
    setLinkMode('email');
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
    const opt = new Option(p.name, p.id);
    opt.dataset.name = (p.name || '').toLowerCase();
    select.appendChild(opt);
  });
  const prefill = readPrefill();
  if (prefill.playerId) select.value = prefill.playerId;
  const emailEl = $('link-email');
  if (prefill.email && emailEl) emailEl.value = prefill.email;
}

function filterLinkPicker() {
  const searchEl = $('link-player-search');
  const select = $('link-player-select');
  if (!searchEl || !select) return;
  const query = searchEl.value.toLowerCase().trim();
  const options = select.options;
  for (let i = 0; i < options.length; i++) {
    const opt = options[i];
    if (!opt.value) { opt.style.display = ''; continue; }
    const name = opt.dataset.name || opt.textContent.toLowerCase();
    opt.style.display = name.includes(query) ? '' : 'none';
  }
}

/* ---------------------------------------------------------------- intents -- */

let linkInFlight = false;
let linkMode = 'email';

function setLinkMode(mode) {
  linkMode = mode;
  const picking = mode === 'pick';
  const picker = $('link-picker-group');
  const hint = $('link-email-hint');
  const toggle = $('link-mode-toggle');
  if (picker) picker.style.display = picking ? '' : 'none';
  if (hint) hint.style.display = picking ? 'none' : '';
  if (toggle) toggle.textContent = picking ? 'Already linked? Sign in with your email' : 'First time here? Pick your name from the roster';
}

function toggleLinkMode() {
  setLinkMode(linkMode === 'pick' ? 'email' : 'pick');
}

function submitAccountLink() {
  if (linkInFlight) return;
  const emailEl = $('link-email');
  const email = emailEl ? emailEl.value.trim() : '';
  const selectEl = $('link-player-select');
  const playerId = linkMode === 'email' ? '' : (selectEl ? selectEl.value : '');

  if (!email) { showStatus('Please enter your email address.', false); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showStatus('Please enter a valid email address.', false); return; }
  if (linkMode === 'pick' && !playerId) { showStatus('Please select your player name.', false); return; }

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

const TAB_INDEX = { 'vote-view': 0, 'standings-view': 1, 'leaderboard-view': 2, 'myseason-view': 3 };

function confirmUnlink() {
  if (unlinkInFlight) return;
  unlinkInFlight = true;
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
      unlinkInFlight = false;
      clearSession();
      appState.linkedPlayer = null;
      appState.status = 'unlinked';
      appState.careerCache = {};
      appState.careerInFlight = false;
      return fetchInitialAppData();
    })
    .catch((err) => {
      showSpinner(false);
      unlinkInFlight = false;
      showStatus(err.userMessage || err.message || 'Failed to unlink.', false);
      if (appState.linkedPlayer) {
        showTabs(true);
        showLinkedPresence(appState.linkedPlayer);
        setActiveView(lastView, TAB_INDEX[lastView] || 0);
      } else {
        showTabs(false);
        setActiveView('link-view', 0);
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
  } else if (tabId === 'standings-view') {
    clearStatus();
    showSpinner(false);
    setActiveView('standings-view', 1);
    appState.lastView = 'standings-view';
    loadStandingsData();
  } else if (tabId === 'leaderboard-view') {
    clearStatus();
    showSpinner(false);
    setActiveView('leaderboard-view', 2);
    appState.lastView = 'leaderboard-view';
    loadLeaderboardData();
  } else if (tabId === 'myseason-view') {
    if (appState.linkedPlayer) {
      clearStatus();
      showSpinner(false);
      setActiveView('myseason-view', 3);
      appState.lastView = 'myseason-view';
      loadMySeasonStats();
      loadCareerStats();
    } else {
      setActiveView('link-view', 3);
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
  (leaders || []).forEach((l) => l1.appendChild(new Option(LeagueCore.leaderOptionLabel(l), l.id)));
  (players || []).forEach((p) => {
    if (String(p.id) !== String(currentUserId)) opp.appendChild(new Option(p.name, p.id));
  });
}

function ensureOption(selectId, value, label) {
  const sel = $(selectId);
  if (!sel || !value) return;
  const exists = Array.prototype.some.call(sel.options, (o) => o.value === String(value));
  if (!exists) sel.insertBefore(new Option(label || String(value), value), sel.options[1] || null);
  sel.value = String(value);
}

function changeVote() {
  const voteForm = $('vote-form');
  const votedCard = $('already-voted-card');
  if (voteForm) voteForm.style.display = '';
  if (votedCard) votedCard.style.display = 'none';
  clearStatus();

  if (appState.currentVote) {
    const leader = (appState.leaders || []).find(l => String(l.id) === String(appState.currentVote.leaderId));
    const player = (appState.roster || []).find(p => String(p.id) === String(appState.currentVote.opponentId));
    ensureOption('leader-1', appState.currentVote.leaderId, LeagueCore.leaderOptionLabel(leader));
    ensureOption('favorite-opponent', appState.currentVote.opponentId, player ? player.name : appState.currentVote.opponentId);
  }
}

let voteInFlight = false;
let unlinkInFlight = false;

function submitVotes(isRetry) {
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
    const changeBtn = $('btn-change-vote');
    if (changeBtn) changeBtn.style.display = appState.votingOpen ? 'inline-block' : 'none';
    clearStatus();
    appState.leaderboardCache = {};
    appState.mystatsCache = {};
    appState.currentVote = { leaderId: l1, opponentId: opp };
  }

  const action = LeagueCore.voteSubmitAction(appState.currentVote);
  callApi(action, { voteData: { leader1Id: l1, opponentId: opp } })
    .then(() => { endFlight(); showVoteRecorded(); fetchInitialAppData(); })
    .catch((err) => {
      endFlight();
      const msg = err.userMessage || err.message || '';
      if (LeagueCore.shouldRetryAsNewVote(msg, isRetry)) {
        appState.currentVote = null;
        submitVotes(true);
      } else if (msg.includes('already submitted votes for this week')) {
        showVoteRecorded();
      } else {
        showStatus(msg || 'Vote submission failed.', false);
      }
    });
}

/* ----------------------------------------------------------- standings --- */

function loadStandingsData() {
  const sel = $('standings-season-filter');
  const roundSel = $('standings-round-filter');
  const selectedSeasonId = sel ? sel.value : '';
  const asOfRound = roundSel ? roundSel.value : '';

  if (isFreshCache(appState.standingsCache, selectedSeasonId + '-' + asOfRound)) {
    renderStandings(appState.standingsCache[selectedSeasonId + '-' + asOfRound].data);
    return;
  }

  if (appState.standingsInFlight && appState.standingsInFlightSeason === selectedSeasonId + '-' + asOfRound) {
    showSpinner(true, 'standings');
    return;
  }

  const token = ++appState.standingsToken;
  appState.standingsInFlight = true;
  appState.standingsInFlightSeason = selectedSeasonId + '-' + asOfRound;
  showSpinner(true, 'standings');

  const payload = { seasonId: selectedSeasonId };
  if (asOfRound) payload.asOfRound = parseInt(asOfRound, 10);

  callApi('getStandingsData', payload)
    .then((res) => {
      if (token !== appState.standingsToken) return;
      appState.standingsInFlight = false;
      appState.standingsInFlightSeason = null;
      showSpinner(false, 'standings');
      appState.standingsCache[selectedSeasonId + '-' + asOfRound] = { data: res, ts: Date.now() };
      renderStandings(res);
    })
    .catch((err) => {
      if (token !== appState.standingsToken) return;
      appState.standingsInFlight = false;
      appState.standingsInFlightSeason = null;
      showSpinner(false, 'standings');
      showStatus(err.userMessage || err.message || 'Failed to load standings.', false);
    });
}

function renderStandings(res) {
  standingsShowAll = false;
  updateRoundFilter(res.allRegularRounds || res.rounds, res.asOfRound);
  renderStandingsTable(res.table);
  renderRoundResults(res.rounds);
  const content = $('standings-content');
  if (content) content.style.display = 'block';
}

function updateRoundFilter(rounds, asOfRound) {
  const sel = $('standings-round-filter');
  if (!sel) return;
  sel.innerHTML = '';
  (rounds || []).forEach(r => {
    const opt = document.createElement('option');
    opt.value = r.round;
    opt.textContent = 'R' + r.round;
    if (String(r.round) === String(asOfRound)) opt.selected = true;
    sel.appendChild(opt);
  });
}

const STANDINGS_PAGE_SIZE = 12;
let standingsShowAll = false;

function renderStandingsTable(table) {
  const tbody = $('standings-table-body');
  if (!tbody) return;
  if (!table || table.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:#94a3b8; padding:16px;">No standings data.</td></tr>';
    return;
  }
  const players = appState.roster || [];
  const nameMap = {};
  players.forEach(p => { nameMap[p.id] = p.name; });

  const rows = table.map(row => {
    const rankClass = row.rank <= 3 ? ' rank-' + row.rank : '';
    const playerName = nameMap[row.playerId] || row.playerId;
    return `<tr class="standings-row${rankClass}" ${row.rank > STANDINGS_PAGE_SIZE && !standingsShowAll ? 'style="display:none;"' : ''}>
      <td style="font-weight:700;">${escapeHtml(row.rank)}</td>
      <td style="font-weight:600;">${escapeHtml(playerName)}</td>
      <td style="text-align:center;">${escapeHtml(row.played)}</td>
      <td style="text-align:center;">${escapeHtml(row.won)}</td>
      <td style="text-align:center;">${escapeHtml(row.drawn)}</td>
      <td style="text-align:center;">${escapeHtml(row.lost)}</td>
      <td style="text-align:center; font-weight:700; color:#38bdf8;">${escapeHtml(row.points)}</td>
    </tr>`;
  });
  tbody.innerHTML = rows.join('');

  const wrap = $('standings-table-wrap');
  if (!wrap) return;
  const existing = $('show-more-standings');
  if (existing) existing.remove();

  if (table.length > STANDINGS_PAGE_SIZE) {
    const btn = document.createElement('button');
    btn.id = 'show-more-standings';
    btn.className = 'show-more-btn';
    btn.textContent = standingsShowAll ? 'Show less' : 'Show all ' + table.length + ' players';
    btn.onclick = () => {
      standingsShowAll = !standingsShowAll;
      renderStandingsTable(table);
    };
    wrap.appendChild(btn);
  }
}

function renderRoundResults(rounds) {
  const container = $('round-results-container');
  if (!container) return;
  if (!rounds || rounds.length === 0) {
    container.innerHTML = '<div style="text-align:center; color:#94a3b8; padding:12px;">No round data.</div>';
    return;
  }

  const players = appState.roster || [];
  const nameMap = {};
  players.forEach(p => { nameMap[p.id] = p.name; });

  container.innerHTML = rounds.map(round => {
    const phaseClass = 'round-phase-' + round.phase;
    const isCut = round.phase === 'cut';
    const isSide = round.phase === 'side';
    const phaseLabel = isCut ? 'Top Cut' : (isSide ? 'Side Event' : 'Regular');
    const dateStr = formatNightDate(round.date);
    const title = (isCut ? 'CUT' : isSide ? 'SIDE' : 'R' + round.round) + (dateStr ? ' — ' + dateStr : '');
    const playerRows = (round.players || [])
      .sort((a, b) => (a.rank || 999) - (b.rank || 999))
      .map(p => {
        const playerName = nameMap[p.playerId] || p.playerId;
        return `<div class="stats-row" style="padding:6px 10px;">
          <div class="stats-left">
            <div class="rank-pill" style="width:24px; height:24px; font-size:0.65rem;">#${escapeHtml(p.rank || '-')}</div>
            <span class="stats-title" style="font-size:0.85rem;">${escapeHtml(playerName)}</span>
          </div>
          <span class="stats-score" style="font-size:0.8rem;">${escapeHtml(p.points)} pts</span>
        </div>`;
      })
      .join('');

    return `<div class="round-card">
      <div class="round-header" onclick="this.nextElementSibling.classList.toggle('open')">
        <span class="round-title">${title}</span>
        <span class="round-phase ${phaseClass}">${escapeHtml(phaseLabel)}</span>
      </div>
      <div class="round-body">${playerRows || '<div style="color:#94a3b8; padding:8px 0;">No standings recorded.</div>'}</div>
    </div>`;
  }).join('');
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
  listExpanded = {};
  const lpCard = $('leaderboard-participation-card');
  const lpText = $('leaderboard-participation-text');
  if (lpCard && lpText) {
    const p = res.participation;
    if (p && p.totalVotes > 0) {
      lpText.textContent = p.totalVotes + ' votes cast by ' + p.playersWhoVoted + ' players this season';
      lpCard.style.display = 'block';
    } else {
      lpCard.style.display = 'none';
    }
  }

  renderStatsList('most-played-container', res.leaderLeaderboard || [], {
    getTitle: (item) => LeagueCore.leaderOptionLabel(item),
    getScore: (item) => item.score,
    getSubtitle: (item) => item.subtitle,
    limit: 5,
    expandable: true
  });
  renderLeaderboardSection('schemer-section', 'schemer-container', res, 'schemer');
  renderLeaderboardSection('ambassador-section', 'ambassador-container', res, 'ambassador');
  renderLeaderboardSection('ruler-section', 'ruler-container', res, 'ruler');
  renderLeaderboardSection('champion-section', 'champion-container', res, 'champion');
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
    getSubtitle: (item) => item.subtitle,
    expandable: true,
    noun: 'players'
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
  const streaks = res.streaks || {};
  const raffle = res.raffleTickets || 0;
  const view = LeagueCore.gamificationViewFor(res.isCurrentSeason !== false, res.hasVoteData !== false);

  const milestoneContainer = $('myseason-milestone-container');
  const milestoneBar = $('milestone-bar');
  const milestoneText = $('milestone-text');
  if (milestoneContainer) {
    if (view === 'full' && res.milestone && milestoneBar && milestoneText) {
      const votes = res.milestone.votes || 0;
      const target = res.milestone.target || 4;
      const pct = Math.min(100, Math.round((votes / target) * 100));
      milestoneBar.style.width = pct + '%';
      milestoneText.textContent = votes + ' of ' + target + ' votes' + (res.milestone.complete ? ' — Prize earned!' : '');
      milestoneContainer.style.display = 'block';
    } else {
      milestoneContainer.style.display = 'none';
    }
  }

  if (gamSection && gamContainer) {
    if (view === 'hidden') {
      gamSection.style.display = 'none';
    } else {
      let html = '';
      html += `<div><span style="color:#94a3b8;">Raffle tickets:</span> <strong style="color:#fbbf24;">${escapeHtml(raffle)}</strong> <span style="font-size:0.8rem; color:#64748b;">— every vote is a ticket for the season-end raffle</span></div>`;
      if (view === 'full' && (streaks.currentStreak > 0 || streaks.bestStreak > 0)) {
        html += `<div style="margin-top:6px;"><span style="color:#94a3b8; font-size:0.8rem;">Streak:</span> <span style="font-size:0.85rem;">${escapeHtml(streaks.currentStreak)} current &bull; ${escapeHtml(streaks.bestStreak)} best</span></div>`;
      } else if (view === 'summary' && streaks.bestStreak > 0) {
        html += `<div style="margin-top:6px;"><span style="color:#94a3b8; font-size:0.8rem;">Streak:</span> <span style="font-size:0.85rem;">${escapeHtml(streaks.bestStreak)} best (season record)</span></div>`;
      }
      gamContainer.innerHTML = html;
      gamSection.style.display = 'block';
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
    getTitle: (item) => LeagueCore.leaderOptionLabel(item),
    getScore: (item) => `${item.plays} Plays`,
    limit: Infinity
  });

  const content = $('myseason-content');
  if (content) content.style.display = 'block';
}

function loadCareerStats() {
  if (!appState.linkedPlayer) return;
  const cacheKey = 'career';
  if (isFreshCache(appState.careerCache, cacheKey)) {
    renderCareerStats(appState.careerCache[cacheKey].data);
    return;
  }
  if (appState.careerInFlight) return;
  appState.careerInFlight = true;
  callApi('getMyCareerStats', {})
    .then((res) => {
      appState.careerInFlight = false;
      appState.careerCache = { [cacheKey]: { data: res, ts: Date.now() } };
      renderCareerStats(res);
    })
    .catch(() => { appState.careerInFlight = false; });
}

function renderCareerStats(res) {
  const section = $('career-section');
  const empty = $('career-empty');
  const recordCard = $('career-record-card');
  const rivalryCard = $('career-rivalry-card');
  const progressionCard = $('career-progression-card');
  if (!section) return;

  if (!res || !res.hasCareerData) {
    section.style.display = 'block';
    empty.style.display = 'block';
    recordCard.style.display = 'none';
    rivalryCard.style.display = 'none';
    progressionCard.style.display = 'none';
    return;
  }

  section.style.display = 'block';
  empty.style.display = 'none';

  const r = res.record;
  const rec = r.matches;
  const pct = (v) => v == null ? '—' : v + '%';
  const recordHtml = `
    <div style="font-weight:700; color:#f8fafc; margin-bottom:8px;">Career record${r.sinceSeason ? ' — since S' + escapeHtml(r.sinceSeason) : ''}</div>
    <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:8px; font-size:0.85rem;">
      <div><span style="color:#94a3b8;">Nights</span><br><strong style="color:#f8fafc;">${escapeHtml(r.nights)}</strong></div>
      <div><span style="color:#94a3b8;">Matches</span><br><strong style="color:#f8fafc;">${escapeHtml(rec.played)}</strong></div>
      <div><span style="color:#94a3b8;">W-D-L</span><br><strong style="color:#f8fafc;">${escapeHtml(rec.wins)}-${escapeHtml(rec.draws)}-${escapeHtml(rec.losses)}</strong></div>
      <div><span style="color:#94a3b8;">Win %</span><br><strong style="color:#f8fafc;">${pct(rec.winPct)}</strong></div>
      <div><span style="color:#94a3b8;">Game win %</span><br><strong style="color:#f8fafc;">${pct(rec.gameWinPct)}</strong></div>
      <div><span style="color:#94a3b8;">Sweeps</span><br><strong style="color:#f8fafc;">${escapeHtml(rec.sweeps)}${rec.played > 0 ? ' (' + Math.round(rec.sweeps / rec.played * 100) + '%)' : ''}</strong></div>
      <div><span style="color:#94a3b8;">Deciders</span><br><strong style="color:#f8fafc;">${escapeHtml(rec.deciders)}</strong></div>
      <div><span style="color:#94a3b8;">Draws</span><br><strong style="color:#f8fafc;">${escapeHtml(rec.draws)}</strong></div>
      <div><span style="color:#94a3b8;">Byes</span><br><strong style="color:#f8fafc;">${escapeHtml(rec.byes)}</strong></div>
    </div>`;
  recordCard.innerHTML = recordHtml;
  recordCard.style.display = 'block';

  const nem = res.rivalry.nemesis;
  const vic = res.rivalry.victim;
  let rivalryHtml = '';
  if (nem.length === 0 && vic.length === 0 && res.rivalry.headToHead.length === 0) {
    rivalryHtml = '<div style="color:#94a3b8; font-size:0.85rem;">No rivalries yet — they appear after you face someone at least twice.</div>';
  } else {
    if (nem.length > 0) {
      const names = nem.map(n => escapeHtml(n.name)).join(' & ');
      rivalryHtml += `<div style="margin-bottom:6px;"><span style="color:#ef4444; font-weight:700;">Nemesis:</span> <span style="color:#f8fafc;">${names}</span> <span style="color:#94a3b8; font-size:0.85rem;">— beat you ${escapeHtml(nem[0].count)}×</span></div>`;
    }
    if (vic.length > 0) {
      const names = vic.map(v => escapeHtml(v.name)).join(' & ');
      rivalryHtml += `<div style="margin-bottom:6px;"><span style="color:#22c55e; font-weight:700;">Victim:</span> <span style="color:#f8fafc;">${names}</span> <span style="color:#94a3b8; font-size:0.85rem;">— you beat them ${escapeHtml(vic[0].count)}×</span></div>`;
    }
    rivalryHtml += '<div id="career-h2h-container" style="margin-top:8px;"></div>';
  }
  rivalryCard.innerHTML = rivalryHtml;
  rivalryCard.style.display = 'block';

  if (res.rivalry.headToHead.length > 0) {
    renderStatsList('career-h2h-container', res.rivalry.headToHead, {
      getTitle: (item) => `${item.name} — ${item.wins}W ${item.losses}L${item.draws ? ' ' + item.draws + 'D' : ''}`,
      getScore: (item) => `${item.played}×`,
      limit: 3,
      expandable: true,
      noun: 'matchup'
    });
  }

  const prog = res.progression;
  const peak = res.peak;
  let progHtml = '<div style="font-weight:700; color:#f8fafc; margin-bottom:8px;">Season progression</div>';
  if (peak) {
    progHtml += `<div style="margin-bottom:8px;"><span style="color:#fbbf24;">Peak:</span> <span style="color:#f8fafc;">#${escapeHtml(peak.rank)} (S${escapeHtml(peak.seasonId)})</span></div>`;
  }
  if (prog.length > 0) {
    progHtml += prog.map(p => {
      const rank = p.rank != null ? '#' + p.rank : '—';
      const pts = p.points != null ? p.points + ' pts' : '';
      const currentMark = p.isCurrent ? ' ★' : '';
      const asOf = p.asOfRound != null ? ` (as of R${p.asOfRound})` : '';
      const nights = p.nightsPlayed != null ? `${p.nightsPlayed}N` : '';
      const detail = [nights, pts].filter(Boolean).join(', ');
      return `<span style="color:${p.isCurrent ? '#38bdf8' : '#94a3b8'}; font-size:0.85rem;">S${escapeHtml(p.seasonId)} ${escapeHtml(rank)}${detail ? ' · ' + escapeHtml(detail) : ''}${asOf}${currentMark}</span>`;
    }).join('<span style="color:#475569; margin:0 6px;">→</span>');
  }
  progressionCard.innerHTML = progHtml;
  progressionCard.style.display = 'block';
}

/* -------------------------------------------------------------- utilities -- */

function formatNightDate(iso) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm', day: 'numeric', month: 'numeric' });
  } catch { return null; }
}

function isFreshCache(viewCache, seasonId) {
  return LeagueCore.isFreshCache(viewCache, seasonId, Date.now());
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

let listExpanded = {};

function renderStatsList(containerId, items, config) {
  const container = $(containerId);
  if (!container) return;
  if (!items || items.length === 0) {
    container.innerHTML = '<div style="text-align:center; color:#94a3b8; padding:12px; font-size: 0.85rem;">No statistics recorded.</div>';
    return;
  }
  const limit = config.limit !== undefined ? config.limit : 3;
  const expanded = config.expandable && !!listExpanded[containerId];
  const shown = LeagueCore.visibleListSlice(items, limit, expanded);
  let html = '<div class="stats-list">';
  shown.forEach((item, i) => {
    const rankNumber = item.displayRank !== undefined ? item.displayRank : (i + 1);
    const safeRank = Math.floor(Number(rankNumber)) || 0;
    const title = config.getTitle(item, i);
    const subtitle = config.getSubtitle ? config.getSubtitle(item, i) : null;
    const score = config.getScore(item);
    html += `
      <div class="stats-row rank-${safeRank}">
        <div class="stats-left">
          <div class="rank-pill">#${safeRank}</div>
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
  if (config.expandable && items.length > limit) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'show-more-btn';
    btn.textContent = LeagueCore.listToggleLabel(items.length, limit, expanded, config.noun);
    btn.onclick = () => {
      listExpanded[containerId] = !expanded;
      renderStatsList(containerId, items, config);
    };
    container.appendChild(btn);
  }
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