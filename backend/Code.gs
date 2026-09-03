/**
 * ============================================================================
 * SCRIPT 1: BACKEND & DATABASE ENGINE
 * Executes as: ME (USER_DEPLOYING)
 * Access: ANYONE_ANONYMOUS (anonymous OK; identity secured by per-device
 *          session tokens minted at link time — no shared static secret).
 * ============================================================================
 */

// Config loaded from Apps Script Script Properties at runtime.
// Set these properties in the Apps Script editor (Project Settings -> Script Properties)
// or via the utilities below. They are NOT committed to the repo.
function getConfig(key, fallback) {
  const val = PropertiesService.getScriptProperties().getProperty(key);
  return val || fallback;
}

// Config is read lazily (not at load time) so rotating these Script Properties
// takes effect immediately instead of waiting for a warm Apps Script instance
// to be recycled.
function getSpreadsheetId() {
  return getConfig('SPREADSHEET_ID');
}

const SHEETS = {
  SETTINGS: 'Settings',
  PLAYERS: 'Players',
  LEADERS: 'Leaders',
  SEASONS: 'Seasons',
  LEADER_VOTES: 'LeaderVotes',
  OPPONENT_VOTES: 'OpponentVotes',
  AWARDS: 'Awards',
  SESSIONS: 'Sessions'
};

function getSpreadsheet() {
  const spreadsheetId = getConfig('SPREADSHEET_ID');
  if (!spreadsheetId) {
    throw new Error('Configuration error: SPREADSHEET_ID is missing. Check your .env / deployment environment.');
  }
  return SpreadsheetApp.openById(spreadsheetId);
}

// Returns the spreadsheet handle once per request (shared by the memoized read
// helpers below). Falls back to a fresh handle when no request context is
// supplied, preserving direct-call behavior.
function getSpreadsheetCached(req) {
  if (req && req.cache) {
    if (!req.cache.ss) req.cache.ss = getSpreadsheet();
    return req.cache.ss;
  }
  return getSpreadsheet();
}

// Memoizes `compute()` per request under `req.cache[key]`. When `req` is
// omitted (direct helper calls) the value is always computed fresh.
function reqCached(req, key, compute) {
  if (req && req.cache && key in req.cache) return req.cache[key];
  const value = compute();
  if (req && req.cache) req.cache[key] = value;
  return value;
}

/**
 * Web App Endpoint: Receives proxy API requests from Script 2.
 */
function userError(msg) { const e = new Error(msg); e.userMessage = msg; throw e; }

function doPost(e) {
  let action = '';
  try {
    const payload = JSON.parse(e.postData.contents);
    action = payload.action;
    // Per-request memo context shared by the data helpers so each sheet and
    // external standing is opened/fetched at most once per request. Passing
    // no context (direct helper calls from tests/tools) keeps the old
    // behavior.
    const req = { cache: {} };

    // Open / token-optional actions may be called with no identity at all.
    // Everything else needs a valid session token (token-only model).
    const openActions = ['linkAccount', 'unlinkAccount', 'getLeaderboardData'];
    const tokenOptional = ['getAppData'];
    const token = String(payload.token || '').trim();

    // Token-only identity: resolve the token to its linked player's email.
    // Lazily GCs stale sessions (invalid tokens resolve to '' and re-trigger
    // link). The legacy client-asserted userEmail path was removed at cut-over.
    const session = token ? findSessionByToken(token, req) : null;
    const effectiveEmail = session ? session.email : '';

    const needsIdentity = openActions.indexOf(action) === -1 && tokenOptional.indexOf(action) === -1;
    if (needsIdentity && !effectiveEmail) {
      // Identity-bound action without a valid session token.
      userError('Missing or invalid session. Please link your player account.');
    }

    // Only write operations need the script lock so two concurrent voters
    // can't both pass the duplicate-check. Read-only actions run
    // concurrently, eliminating the "Database is busy" bottleneck for
    // leaderboard/stats requests that perform slow site fetches.
    const needsLock = (action === 'submitVote' ||
                       action === 'linkAccount' || action === 'unlinkAccount');
    const lock = LockService.getScriptLock();
    if (needsLock && !lock.tryLock(10000)) {
      return createJsonResponse({ success: false, error: 'Database is busy. Please try again.' });
    }

    try {
      let result = {};

      if (action === 'getAppData') {
        result = handleGetAppData(effectiveEmail, req, token);
      } else if (action === 'linkAccount') {
        result = handleLinkAccount(payload, req);
      } else if (action === 'unlinkAccount') {
        result = handleUnlinkAccount(payload, req);
      } else if (action === 'submitVote') {
        result = handleSubmitVote(payload, effectiveEmail, req);
      } else if (action === 'getLeaderboardData') {
        result = handleGetLeaderboardData(payload.seasonId, req);
      } else if (action === 'getMySeasonStats') {
        result = handleGetMySeasonStats(payload.seasonId, effectiveEmail, req);
      } else {
        throw new Error('Invalid action requested.');
      }

      return createJsonResponse({ success: true, data: result });
    } finally {
      if (needsLock) lock.releaseLock();
    }
  } catch (err) {
    console.error('API Error:', err);
    var gen = { getAppData: "Couldn't load your league data. Please try again.",
                linkAccount: "We couldn't link your account. Please try again.",
                unlinkAccount: "We couldn't unlink this device. Please try again.",
                submitVote: "We couldn't submit your vote. Please try again.",
                getLeaderboardData: "Couldn't load the leaderboard. Please try again.",
                getMySeasonStats: "Couldn't load your stats. Please try again."
              }[action] || 'Something went wrong. Please try again.';
    return createJsonResponse({ success: false, error: err.userMessage || gen });
  }
}

function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ============================================================================
 * SETTINGS & CONFIGURATION HELPERS
 * ============================================================================ */

function getSettings(req) {
  return reqCached(req, 'settings', () => {
    const ss = getSpreadsheetCached(req);
    const sheet = ss.getSheetByName(SHEETS.SETTINGS);
    if (!sheet) return {};

    const data = sheet.getDataRange().getValues();
    const settings = {};
    for (let i = 1; i < data.length; i++) {
      if (data[i][0]) {
        settings[String(data[i][0]).trim()] = data[i][1];
      }
    }
    return settings;
  });
}

function updateSetting(sheet, key, value) {
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === key) {
      sheet.getRange(i + 1, 2).setValue(value);
      return;
    }
  }
  sheet.appendRow([key, value]);
}

function parseWeek(val) {
  const m = String(val || '').match(/\d+/);
  return m ? Number(m[0]) : 1;
}

// SEASON_LENGTH is a manual configuration in the Settings sheet (key/value),
// telling the code how many rounds a season runs. Unlike CURRENT_WEEK /
// ACTIVE_SEASON_ID it is never written by the code — it is a fixed parameter.
// It is required, so we fail loudly rather than guessing if it is missing.
function getSeasonLength(req) {
  const val = Number(getSettings(req).SEASON_LENGTH);
  if (!Number.isInteger(val) || val <= 0) {
    throw new Error('SEASON_LENGTH is not set in Settings.');
  }
  return val;
}

/* ============================================================================
 * DATA RETRIEVAL HELPERS
 * ============================================================================ */

function getAllSeasons(req) {
  return reqCached(req, 'allSeasons', () => {
    const ss = getSpreadsheetCached(req);
    const sheet = ss.getSheetByName(SHEETS.SEASONS);
    if (!sheet || sheet.getLastRow() <= 1) return [];

    return sheet.getDataRange().getValues().slice(1)
      .filter(r => r[0] !== undefined && r[0] !== '')
      .map(r => {
        const id = String(r[0]);
        const num = parseInt(id.replace(/\D/g, ''), 10);
        return {
          id: id,
          name: String(r[1] || `Season ${id}`),
          sortNum: isNaN(num) ? 0 : num
        };
      })
      .sort((a, b) => b.sortNum - a.sortNum)
      .map(({ id, name }) => ({ id, name }));
  });
}

function getSeasonName(seasonId, req) {
  if (!seasonId) return 'Unknown Season';
  const seasons = getAllSeasons(req);
  const found = seasons.find(x => String(x.id) === String(seasonId));
  if (found && found.name) return found.name;

  const cleanNum = String(seasonId).replace(/\D/g, '');
  return cleanNum ? `Season ${cleanNum}` : `Season ${seasonId}`;
}

function getSeasonPlayers(req) {
  return reqCached(req, 'players', () => {
    const ss = getSpreadsheetCached(req);
    const masterPlayers = {};

    const playerSheet = ss.getSheetByName(SHEETS.PLAYERS);
    if (playerSheet && playerSheet.getLastRow() > 1) {
      playerSheet.getDataRange().getValues().slice(1).forEach(r => {
        if (r[0] && String(r[4] || 'TRUE').toUpperCase() === 'TRUE') {
          masterPlayers[String(r[0])] = {
            id: String(r[0]),
            name: String(r[1]),
            meleeName: String(r[2] || ''),
            email: String(r[3] || '').toLowerCase()
          };
        }
      });
    }

    return Object.values(masterPlayers).sort((a, b) => a.name.localeCompare(b.name));
  });
}

function getUnlinkedPlayers(req) {
  const players = getSeasonPlayers(req);
  return players.filter(p => !p.email);
}

function getSeasonLeaders(req) {
  return reqCached(req, 'leaders', () => {
    const ss = getSpreadsheetCached(req);
    const masterLeaders = {};

    const leaderSheet = ss.getSheetByName(SHEETS.LEADERS);
    if (leaderSheet && leaderSheet.getLastRow() > 1) {
      leaderSheet.getDataRange().getValues().slice(1).forEach(r => {
        if (r[0] && String(r[3] || 'TRUE').toUpperCase() === 'TRUE') {
          masterLeaders[String(r[0])] = {
            id: String(r[0]),
            name: `${r[1]} - ${r[2] || ''}`.trim()
          };
        }
      });
    }

    return Object.values(masterLeaders).sort((a, b) => a.name.localeCompare(b.name));
  });
}

function findPlayerByGoogleEmail(email, req) {
  if (!email) return null;
  return reqCached(req, 'email-' + String(email).toLowerCase().trim(), () => {
    const ss = getSpreadsheetCached(req);
    const sheet = ss.getSheetByName(SHEETS.PLAYERS);
    if (!sheet || sheet.getLastRow() <= 1) return null;

    const target = String(email).toLowerCase().trim();
    const found = sheet.getDataRange().getValues().slice(1)
      .find(r => String(r[3] || '').toLowerCase().trim() === target);

    if (!found) return null;

    return {
      id: String(found[0]),
      name: String(found[1]),
      meleeName: String(found[2] || ''),
      email: target,
      active: String(found[4] || 'TRUE').toUpperCase() === 'TRUE'
    };
  });
}

/* ============================================================================
 * SESSION (token) HELPERS
 * ============================================================================ */

// Returns the Sessions sheet, auto-creating it (with a header) if a stale DB
// doesn't have one yet. Columns: TOKEN, PLAYER_ID, DEVICE_ID, EMAIL, CREATED.
function getSessionsSheet(req) {
  const ss = getSpreadsheetCached(req);
  let sh = ss.getSheetByName(SHEETS.SESSIONS);
  if (!sh) {
    sh = ss.insertSheet(SHEETS.SESSIONS);
    sh.appendRow(['TOKEN', 'PLAYER_ID', 'DEVICE_ID', 'EMAIL', 'CREATED']);
  }
  return sh;
}

function mintToken() {
  return String(Utilities.getUuid());
}

// Looks up an active session by token. Cross-checks that the linked player's
// Players col D email is still set and matches the session; if the admin has
// unclaimed the player (cleared col D) the stale session row is lazily deleted
// and null is returned, so a stale token can never keep voting.
function findSessionByToken(token, req) {
  if (!token) return null;
  const sh = getSessionsSheet(req);
  if (sh.getLastRow() <= 1) return null;
  const rows = sh.getDataRange().getValues().slice(1);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (String(r[0]) === String(token)) {
      const playerId = String(r[1]);
      const email = String(r[3] || '').toLowerCase().trim();
      const player = reqCached(req, 'email-' + email, () => {
        if (!email) return null;
        return findPlayerByGoogleEmail(email, req);
      });
      // Admin unclaimed / email cleared -> drop the stale session.
      if (!player || String(player.id) !== playerId) {
        deleteSessionByToken(token, req);
        return null;
      }
      return { token: String(r[0]), playerId: playerId, deviceId: String(r[2]), email: email };
    }
  }
  return null;
}

function findSessionByPlayerAndDevice(playerId, deviceId, req) {
  if (!deviceId || !playerId) return null;
  const sh = getSessionsSheet(req);
  if (sh.getLastRow() <= 1) return null;
  const rows = sh.getDataRange().getValues().slice(1);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (String(r[1]) === String(playerId) && String(r[2]) === String(deviceId)) {
      return { token: String(r[0]), playerId: String(r[1]), deviceId: String(r[2]), email: String(r[3] || '') };
    }
  }
  return null;
}

function insertSession(playerId, deviceId, email, req) {
  const token = mintToken();
  getSessionsSheet(req).appendRow([token, String(playerId), String(deviceId || ''), String(email || '').toLowerCase().trim(), formatISODate(new Date())]);
  return token;
}

function deleteSessionByToken(token, req) {
  if (!token) return false;
  const sh = getSessionsSheet(req);
  if (sh.getLastRow() <= 1) return false;
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(token)) {
      sh.deleteRow(i + 1);
      return true;
    }
  }
  return false;
}

// Removes every Sessions row for (playerId, deviceId) whose token differs from
// `keepToken`, leaving exactly one active token per device. Safe: rows with a
// different deviceId (legit multi-device logins) are untouched.
function pruneDuplicateDeviceSessions(playerId, deviceId, keepToken, req) {
  if (!deviceId || !playerId || !keepToken) return 0;
  const sh = getSessionsSheet(req);
  if (sh.getLastRow() <= 1) return 0;
  const rows = sh.getDataRange().getValues();
  let removed = 0;
  for (let i = rows.length - 1; i >= 1; i--) {
    const r = rows[i];
    if (String(r[1]) === String(playerId) && String(r[2]) === String(deviceId) && String(r[0]) !== String(keepToken)) {
      sh.deleteRow(i + 1);
      removed++;
    }
  }
  return removed;
}

function hasSubmittedThisWeek(playerId, seasonId, weekVal, req) {
  const ss = getSpreadsheetCached(req);
  const weekNum = parseWeek(weekVal);

  const lvSheet = ss.getSheetByName(SHEETS.LEADER_VOTES);
  if (!lvSheet || lvSheet.getLastRow() <= 1) return false;

  return lvSheet.getDataRange().getValues().slice(1).some(r =>
    String(r[1]) === String(seasonId) &&
    parseWeek(r[2]) === weekNum &&
    String(r[3]) === String(playerId)
  );
}

/* ============================================================================
 * API HANDLERS
 * ============================================================================ */

function isVotingOpen(settings) {
  if (!settings || settings.VOTING_OPEN === undefined || settings.VOTING_OPEN === null) {
    return false; // Safe default: closed if the setting is missing entirely
  }

  const val = settings.VOTING_OPEN;

  // Handle actual boolean values (e.g., if a checkbox is used)
  if (typeof val === 'boolean') {
    return val;
  }

  // Handle string values from the sheet (e.g., "TRUE", "FALSE", "false", etc.)
  const normalized = String(val).trim().toUpperCase();
  return normalized === 'TRUE' || normalized === 'YES' || normalized === '1';
}

function handleGetAppData(userEmail, req, token) {
  const settings = getSettings(req);
  const activeSeasonId = String(settings.ACTIVE_SEASON_ID || '');
  const linkedPlayer = findPlayerByGoogleEmail(userEmail, req);
  console.info(`[AppData] userEmail=${userEmail} linked=${Boolean(linkedPlayer)}`);
  const currentWeek = parseWeek(settings.CURRENT_WEEK);
  const votingOpen = isVotingOpen(settings);

  const allSeasons = getAllSeasons(req);

  // Status drives the static client's boot branch:
  //  - 'invalid-token' -> stale token, re-prompt to link
  //  - 'linked'        -> show the vote view
  //  - 'unlinked'      -> fresh/returning device, show the link form (bootstrap)
  let status = 'unlinked';
  if (linkedPlayer) {
    status = 'linked';
  } else if (token && !findSessionByToken(token, req)) {
    status = 'invalid-token';
  }

  const data = {
    settings: {
      activeSeasonId: activeSeasonId,
      currentWeek: `Week ${currentWeek}`,
      votingOpen: votingOpen
    },
    status: status,
    seasonId: activeSeasonId,
    seasonName: getSeasonName(activeSeasonId, req),
    seasons: allSeasons,
    week: currentWeek,
    votingOpen: votingOpen,
    userEmail: userEmail,
    linkedPlayer: linkedPlayer,
    currentPlayer: linkedPlayer,
    linked: Boolean(linkedPlayer),
    players: [],
    unlinkedPlayers: [],
    leaders: [],
    alreadySubmitted: false,
    alreadyVoted: false,
    hasVoted: false
  };

  if (linkedPlayer) {
    data.players = getSeasonPlayers(req);
    data.leaders = getSeasonLeaders(req);
    const submitted = hasSubmittedThisWeek(linkedPlayer.id, activeSeasonId, currentWeek, req);
    data.alreadySubmitted = submitted;
    data.alreadyVoted = submitted;
    data.hasVoted = submitted;
  } else {
    data.unlinkedPlayers = getUnlinkedPlayers(req);
    // Full active roster for the link-form picker, so a returning user whose
    // player is already claimed to their own email can re-pick and re-link.
    // linkAccount still enforces email/player ownership on submission.
    data.players = getSeasonPlayers(req);
  }

  return data;
}

function handleLinkGoogleAccount(playerId, email, req) {
  if (!playerId || !email) {
    userError('Missing Player Selection or User Email.');
  }
  console.info(`[Link] attempt email=${email} playerId=${playerId}`);

  const ss = getSpreadsheetCached(req);
  const sheet = ss.getSheetByName(SHEETS.PLAYERS);
  const rows = sheet.getDataRange().getValues();

  const existing = findPlayerByGoogleEmail(email, req);
  if (existing) {
    if (existing.id === String(playerId)) {
      console.info(`[Link] already-linked email=${email} playerId=${playerId}`);
      return { player: existing, linkedPlayer: existing, votingOpen: isVotingOpen(getSettings(req)) };
    }
    console.warn(`[Link] REJECTED email-taking email=${email} attemptedPlayerId=${playerId} takenBy=${existing.id} (${existing.name})`);
    userError('Google account already linked to ' + existing.name);
  }

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(playerId)) {
      if (String(rows[i][3] || '').trim()) {
        console.warn(`[Link] REJECTED player-taken playerId=${playerId} existingEmail=${String(rows[i][3]).toLowerCase().trim()}`);
        userError('This player is already linked to another account.');
      }
      sheet.getRange(i + 1, 4).setValue(email.toLowerCase().trim());

      const playerObj = {
        id: String(rows[i][0]),
        name: String(rows[i][1]),
        meleeName: String(rows[i][2] || ''),
        email: email.toLowerCase().trim(),
        active: String(rows[i][4] || 'TRUE').toUpperCase() === 'TRUE'
      };
      console.info(`[Link] LINKED email=${email} playerId=${playerId}`);

      const settings = getSettings(req);
      const activeSeasonId = String(settings.ACTIVE_SEASON_ID || '');
      const currentWeek = parseWeek(settings.CURRENT_WEEK);

      return {
        success: true,
        player: playerObj,
        linkedPlayer: playerObj,
        players: getSeasonPlayers(req),
        leaders: getSeasonLeaders(req),
        votingOpen: isVotingOpen(settings),
        alreadyVoted: hasSubmittedThisWeek(playerObj.id, activeSeasonId, currentWeek, req)
      };
    }
  }

  throw new Error('Player ID not found in master directory.');
}

// Open self-registration: type an email + pick a player -> link + mint a token.
// Backed by a per-device session so the same account can be on many devices, and
// re-linking the same device (after cleared localStorage) reuses its token.
function handleLinkAccount(payload, req) {
  const playerId = String(payload.playerId || '');
  const email = String(payload.email || '').toLowerCase().trim();
  const deviceId = String(payload.deviceId || '');

  if (!playerId || !email) {
    userError('Missing Player Selection or User Email.');
  }

  // Reuse the existing validation + Players col D write. This returns the unified
  // linked-player shape on both the fresh-link and already-linked paths.
  const linkRes = handleLinkGoogleAccount(playerId, email, req);
  const player = linkRes.linkedPlayer || linkRes.player;
  if (!player) {
    userError('Could not resolve the player after linking.');
  }

  const settings = getSettings(req);
  const activeSeasonId = String(settings.ACTIVE_SEASON_ID || '');
  const currentWeek = parseWeek(settings.CURRENT_WEEK);

  // Reuse an existing token for the same (player, device); otherwise mint one.
  let token = '';
  if (deviceId) {
    const existing = findSessionByPlayerAndDevice(player.id, deviceId, req);
    token = existing ? existing.token : insertSession(player.id, deviceId, email, req);
    // A cold-start double-link can leave a duplicate/superseded row for the same
    // (player, device). Keep only the most recent active token for this device so
    // a single browser never accrues multiple sessions.
    pruneDuplicateDeviceSessions(player.id, deviceId, token, req);
  } else {
    token = insertSession(player.id, '', email, req);
  }

  return {
    success: true,
    player: player,
    linkedPlayer: player,
    players: getSeasonPlayers(req),
    leaders: getSeasonLeaders(req),
    votingOpen: isVotingOpen(settings),
    alreadyVoted: hasSubmittedThisWeek(player.id, activeSeasonId, currentWeek, req),
    token: token,
    unlinkedPlayers: getUnlinkedPlayers(req)
  };
}

// One-device de-auth: delete only this device's session row. Players col D is kept,
// so the player stays claimed by its email (admin can unclaim via a manual sheet edit).
function handleUnlinkAccount(payload, req) {
  const token = String(payload.token || '');
  if (!token) {
    userError('Missing token.');
  }
  const removed = deleteSessionByToken(token, req);
  return { success: true, removed: removed };
}

function handleSubmitVote(payload, email, req) {
  const settings = getSettings(req);

  if (!isVotingOpen(settings)) {
    userError('Voting is currently closed for this week.');
  }

  const player = findPlayerByGoogleEmail(email, req);
  if (!player || (player.active !== undefined && !player.active)) {
    console.warn(`[Vote] REJECTED unknown/inactive email=${email} playerId=${player ? player.id : 'none'}`);
    userError('Identity unlinked or inactive. Please link your player account.');
  }

  const seasonId = String(settings.ACTIVE_SEASON_ID || '');
  const week = parseWeek(settings.CURRENT_WEEK);

  if (hasSubmittedThisWeek(player.id, seasonId, week, req)) {
    console.warn(`[Vote] DUPLICATE email=${email} playerId=${player.id} season=${seasonId} week=${week}`);
    userError('You have already submitted votes for this week.');
  }

  // Normalize vote input formats across UI variants
  const voteData = payload.voteData || payload;
  const leader1Id = voteData.leader1Id || voteData.leaderId || voteData.leader;
  const opponentId = voteData.opponentId || voteData.favoriteOpponentId || voteData.opponent;

  console.info(`[Vote] attempt email=${email} playerId=${player.id} season=${seasonId} week=${week} leader=${leader1Id || 'none'} opponent=${opponentId || 'none'}`);

  if (opponentId && String(opponentId) === String(player.id)) {
    userError("You can't select yourself as your favorite opponent.");
  }

  const ss = getSpreadsheetCached(req);
  const timestamp = new Date();

  let leaderVoteRow = null, opponentVoteRow = null;

  try {
    // 1. Record Leader Votes
    const lvSheet = ss.getSheetByName(SHEETS.LEADER_VOTES);
    if (lvSheet && leader1Id) {
      leaderVoteRow = lvSheet.getLastRow() + 1;
      lvSheet.getRange(leaderVoteRow, 1, 1, 5).setValues([[timestamp, seasonId, week, player.id, leader1Id]]);
    }

    // 2. Record Opponent Vote (de-identified: tally only, no voter attribution)
    if (opponentId) {
      const ovSheet = ss.getSheetByName(SHEETS.OPPONENT_VOTES);
      if (ovSheet) {
        opponentVoteRow = ovSheet.getLastRow() + 1;
        ovSheet.getRange(opponentVoteRow, 1, 1, 4).setValues([[timestamp, seasonId, week, opponentId]]);
      }
    }

    console.info(`[Vote] RECORDED email=${email} playerId=${player.id} season=${seasonId} week=${week} leader=${leader1Id || 'none'} opponent=${opponentId || 'none'}`);
    return { success: true, recorded: true, message: 'Votes successfully recorded!' };

  } catch (err) {
    // Rollback entries on failure, deleting the exact rows we inserted
    if (opponentVoteRow) try { ss.getSheetByName(SHEETS.OPPONENT_VOTES).deleteRow(opponentVoteRow); } catch (e) {}
    if (leaderVoteRow) try { ss.getSheetByName(SHEETS.LEADER_VOTES).deleteRow(leaderVoteRow); } catch (e) {}
    throw err;
  }
}

/* ============================================================================
 * AWARDS PODIUM HELPERS
 *
 * The Awards sheet is a materialized, status-free podium: 15 rows per season
 * (5 awards x 3), each row `[SEASON_ID, AWARD, PLAYER_ID, SCORE]`. SCORE is
 * points (Galactic Ruler), places climbed (A New Hope), distinct-leaders count
 * (Galactic Schemer), opponent-votes count (Galactic Ambassador), or an
 * owner-filled value (Bounty Hunter). Only the ACTIVE season is ever written;
 * historical seasons read purely from the sheet and are never re-scraped.
 * ============================================================================ */

// Which SWU site round is "now" for the active season? During a live week it is
// CURRENT_WEEK; once voting closes CURRENT_WEEK becomes "Season Ended" (which
// parseWeek reads as 1), so we explicitly use the final round (seasonLength).
function failoverRoundFor(settings, seasonLength, isLive) {
  const currentWeek = parseWeek(settings.CURRENT_WEEK);
  const weekInSeason = seasonLength > 0 && currentWeek >= 1 && currentWeek <= seasonLength;
  return (isLive && weekInSeason) ? currentWeek : seasonLength;
}

function seasonNumberFrom(seasonKey) {
  const n = parseInt(String(seasonKey).replace(/\D/g, ''), 10);
  return isFinite(n) ? n : null;
}

// Reads every vote row for a season and returns one tally scan shared by the
// leader board and the voting-derived awards:
//   { leaderCounts: {leaderId: count}, playerLeaders: {playerId: Set(leaderId)},
//     opponentCounts: {playerId: count} }
// Options gate which tallies are built so the vote sheets are only scanned when
// needed: leaderCounts (from LeaderVotes) is always computed for the live
// Most-Played board; playerLeaders and opponentCounts (OpponentVotes scan) are
// skipped unless opts.needPlayerLeaders / opts.needOpponentCounts are true.
function computeVoteTallies(ss, seasonKey, opts) {
  const needPlayerLeaders = !opts || opts.needPlayerLeaders !== false;
  const needOpponentCounts = !opts || opts.needOpponentCounts !== false;
  const leaderCounts = {};
  const playerLeaders = {};
  const opponentCounts = {};

  const lvSheet = ss.getSheetByName(SHEETS.LEADER_VOTES);
  if (lvSheet && lvSheet.getLastRow() > 1) {
    lvSheet.getDataRange().getValues().slice(1).forEach(r => {
      if (String(r[1]) !== seasonKey) return;
      const lId = String(r[4]);
      const pId = String(r[3]);
      if (lId) leaderCounts[lId] = (leaderCounts[lId] || 0) + 1;
      if (needPlayerLeaders && pId && lId) {
        if (!playerLeaders[pId]) playerLeaders[pId] = new Set();
        playerLeaders[pId].add(lId);
      }
    });
  }

  if (needOpponentCounts) {
    const ovSheet = ss.getSheetByName(SHEETS.OPPONENT_VOTES);
    if (ovSheet && ovSheet.getLastRow() > 1) {
      ovSheet.getDataRange().getValues().slice(1).forEach(r => {
        if (String(r[1]) !== seasonKey) return;
        const pId = String(r[3]);
        if (pId) opponentCounts[pId] = (opponentCounts[pId] || 0) + 1;
      });
    }
  }

  return { leaderCounts, playerLeaders, opponentCounts };
}

// Top-3 podium rows stored as `{ id, score }` with ties preserved, ordered by
// score desc. Returns [] when nothing resolves.
function tallyTop3(counts, minScore) {
  const entries = Object.keys(counts)
    .filter(k => counts[k] >= (minScore === undefined ? 1 : minScore))
    .map(k => ({ id: k, score: counts[k] }))
    .sort((a, b) => b.score - a.score);
  if (entries.length === 0) return [];
  const top = entries[0].score;
  return entries.filter(e => e.score === top).slice(0, 3);
}

// Galactic Schemer: top-3 players by distinct leaders played.
function computeSchemerPodium(ss, seasonKey) {
  const { playerLeaders } = computeVoteTallies(ss, seasonKey, { needPlayerLeaders: true });
  const counts = {};
  Object.keys(playerLeaders).forEach(pId => {
    if (playerLeaders[pId].size > 0) counts[pId] = playerLeaders[pId].size;
  });
  return tallyTop3(counts);
}

// Galactic Ambassador: top-3 players by favorite-opponent votes.
function computeAmbassadorPodium(ss, seasonKey) {
  const { opponentCounts } = computeVoteTallies(ss, seasonKey, { needOpponentCounts: true });
  return tallyTop3(opponentCounts);
}

// Galactic Ruler: top-3 by (rank, points) from a round's standings, so rank 1
// is always the lowest sheet row (row 1 = rank 1). Returns `{id, score: points}`.
// `req` (optional) enables per-request memoization of the site fetches.
function computeRulerPodium(seasonNumber, roundNumber, resolvePlayerId, req) {
  if (!seasonNumber || !roundNumber) return [];
  const standings = fetchSeasonStandings(seasonNumber, roundNumber, req);
  if (!standings || standings.length === 0) return [];
  const ranked = standings
    .map(s => ({ entry: s, id: resolvePlayerId(s) }))
    .filter(x => x.id)
    .sort((a, b) => (a.entry.rank - b.entry.rank) || (b.entry.points - a.entry.points));
  return ranked.slice(0, 3).map(x => ({ id: x.id, score: x.entry.points }));
}

// A New Hope: top-3 by places climbed between the midpoint round and the
// comparison round, counting only players present in both. Returns `{id, score}`.
// `req` (optional) enables per-request memoization of the site fetches.
function computeHopePodium(seasonNumber, midRound, compRound, resolvePlayerId, req) {
  if (!seasonNumber || !midRound || !compRound) return [];
  const midStandings = fetchSeasonStandings(seasonNumber, midRound, req);
  const finStandings = fetchSeasonStandings(seasonNumber, compRound, req);
  if (!midStandings || !finStandings || midStandings.length === 0 || finStandings.length === 0) return [];
  const midRank = {};
  midStandings.forEach(s => { midRank[String(s.username || s.name)] = s.rank; });
  const climbs = finStandings
    .filter(s => s.username && midRank[String(s.username)] !== undefined)
    .map(s => ({ entry: s, climbed: midRank[String(s.username)] - s.rank }))
    .filter(c => c.climbed > 0)
    .map(c => ({ entry: c.entry, id: resolvePlayerId(c.entry), climbed: c.climbed }))
    .filter(x => x.id);
  if (climbs.length === 0) return [];
  climbs.sort((a, b) => b.climbed - a.climbed);
  return climbs.slice(0, 3).map(c => ({ id: c.id, score: c.climbed }));
}

// Locates the contiguous rows for (seasonKey, awardName). Returns
// { startRow, firstData, rows } where firstData is the 0-based data index and
// startRow is the 1-based sheet row, or null when the block does not exist.
function findPodiumBlock(awardsSheet, seasonKey, awardName) {
  const data = awardsSheet.getDataRange().getValues().slice(1);
  const matching = [];
  data.forEach((r, i) => {
    if (String(r[0]) === seasonKey && String(r[1]) === awardName) matching.push(i);
  });
  if (matching.length === 0) return null;
  return { startRow: matching[0] + 2, firstData: matching[0], rows: matching.map(i => i + 2) };
}

// Writes a 3-row podium block for (seasonKey, awardName) in place. When
// `entries` is non-empty the first-3 slots are overwritten and any excess rows
// are blanked (legacy tie blocks normalize to exactly 3). When `entries` is
// empty the block is only created (3 blank rows) if it is missing — an existing
// filled block (manual Bounty, or a prior successful site fill with the site now
// down) is never clobbered.
function writePodiumBlock(awardsSheet, seasonKey, awardName, entries, hasData) {
  const size = 3;
  const block = findPodiumBlock(awardsSheet, seasonKey, awardName);

  if (!hasData) {
    // No winner data: keep whatever exists; only ensure the skeleton exists.
    if (!block) {
      const blank = [
        [seasonKey, awardName, '', ''],
        [seasonKey, awardName, '', ''],
        [seasonKey, awardName, '', '']
      ];
      awardsSheet.getRange(awardsSheet.getLastRow() + 1, 1, size, 4).setValues(blank);
    }
    return;
  }

  // Build the 3 rows, padding with empty positions and deduplicating.
  const padded = entries.slice(0, 3);
  while (padded.length < size) padded.push({ id: '', score: '' });
  const rows = padded.map(e => [seasonKey, awardName, e.id, e.score]);

  if (block) {
    // Overwrite the first-3 slots in place; blank any legacy excess rows.
    awardsSheet.getRange(block.startRow, 1, size, 4).setValues(rows);
    if (block.rows.length > 3) {
      for (let i = 3; i < block.rows.length; i++) {
        awardsSheet.getRange(block.rows[i], 1, 1, 4).setValues([[seasonKey, awardName, '', '']]);
      }
    }
  } else {
    awardsSheet.getRange(awardsSheet.getLastRow() + 1, 1, size, 4).setValues(rows);
  }
}

// Materializes the ACTIVE season's full 15-row award podium into the Awards
// sheet. Runs under an already-held script lock (called from the weekly sync and
// the season-close paths). Historical seasons are never touched.
function refreshAwardsPodium(seasonId) {
  const ss = getSpreadsheet();
  const settings = getSettings();
  const activeSeasonId = String(settings.ACTIVE_SEASON_ID || '');
  const seasonKey = String(seasonId || '');

  if (!seasonKey || seasonKey !== activeSeasonId) {
    return { success: false, reason: 'not-active' };
  }

  const awardsSheet = ss.getSheetByName(SHEETS.AWARDS);
  if (!awardsSheet) {
    return { success: false, reason: 'no-awards-sheet' };
  }

  // SEASON_LENGTH is required for the site-derived awards. When it is missing we
  // degrade gracefully (write the vote-derived awards and skeletons, skip the
  // site-derived ones) rather than throwing out of the roster-sync trigger.
  let seasonLength = 0;
  try { seasonLength = getSeasonLength(); } catch (e) { /* SEASON_LENGTH not set */ }

  const votingOpen = isVotingOpen(settings);
  const isLive = votingOpen;
  const failoverRound = failoverRoundFor(settings, seasonLength, isLive);
  const seasonNumber = seasonNumberFrom(seasonKey);

  const { resolvePlayerId } = buildPlayerIdResolvers(ss);

  const ruler = seasonLength > 0 ? computeRulerPodium(seasonNumber, failoverRound, resolvePlayerId) : [];
  const midRound = seasonLength > 0 ? Math.floor(seasonLength / 2) : 0;
  const hope = seasonLength > 0 ? computeHopePodium(seasonNumber, midRound, failoverRound, resolvePlayerId) : [];

  // Vote-derived awards; a season may simply not have votes yet, which leaves
  // the blocks skeleton-only (created but blank).
  const schemer = computeSchemerPodium(ss, seasonKey);
  const ambassador = computeAmbassadorPodium(ss, seasonKey);

  writePodiumBlock(awardsSheet, seasonKey, AWARD_NAMES.AMBASSADOR, ambassador, ambassador.length > 0);
  writePodiumBlock(awardsSheet, seasonKey, AWARD_NAMES.SCHEMER, schemer, schemer.length > 0);
  writePodiumBlock(awardsSheet, seasonKey, AWARD_NAMES.RULER, ruler, seasonLength > 0 && ruler.length > 0);
  writePodiumBlock(awardsSheet, seasonKey, AWARD_NAMES.HOPE, hope, seasonLength > 0 && hope.length > 0);
  // Bounty Hunter is manual: create its skeleton, never write to it.
  writePodiumBlock(awardsSheet, seasonKey, AWARD_NAMES.HUNTER, [], false);

  return { success: true, seasonId: seasonKey };
}

// Reads a season's stored podium block from an in-memory Awards data array
// (0-based, header already sliced off) as leaderboard entries, first 3
// non-empty rows, ranked by SCORE. Returns null when the block is absent or has
// no filled rows (callers fall back to live sources for the active season).
// NOTE: this never touches the sheet — the caller reads Awards once and passes
// the same array, so 5 awards cost 1 sheet read instead of 10.
function materializeBlock(awardsData, seasonKey, awardName, playerMap) {
  if (!awardsData || awardsData.length === 0) return null;

  const entries = [];
  awardsData.forEach(row => {
    if (String(row[0]) !== seasonKey || String(row[1]) !== awardName) return;
    const id = String(row[2] || '').trim();
    if (!id) return;
    const sc = Number(row[3]);
    entries.push({ id: id, name: playerMap[id] || id, score: Number.isFinite(sc) ? sc : 0 });
  });
  if (entries.length === 0) return null;

  const ranked = assignStandardRanks(
    entries.map(e => ({ id: e.id, name: e.name, count: e.score })),
    'count'
  );
  return ranked.map(e => ({
    id: e.id,
    name: e.name,
    displayRank: e.displayRank,
    score: e.count,
    subtitle: null
  }));
}

function handleGetLeaderboardData(requestedSeasonId, req) {
  const settings = getSettings(req);
  const activeSeasonId = String(settings.ACTIVE_SEASON_ID || '');
  const targetSeasonId = requestedSeasonId ? String(requestedSeasonId) : activeSeasonId;

  const isActiveSeason = (String(targetSeasonId) === activeSeasonId);
  const votingOpen = isVotingOpen(settings);
  // "Live" tracking: only while this season is the active one AND voting is
  // open. The board flips to the award / final-round view the moment voting
  // closes, even before startNewSeason resets the settings.
  const isLive = isActiveSeason && votingOpen;

  let seasonLength = 0;
  try { seasonLength = getSeasonLength(req); } catch (e) { /* SEASON_LENGTH not set */ }
  const currentWeek = parseWeek(settings.CURRENT_WEEK);
  const weekInSeason = seasonLength > 0 && currentWeek >= 1 && currentWeek <= seasonLength;

  const ss = getSpreadsheetCached(req);

  // Player id->name map plus site-entry lookup.
  const { playerNames: playerMap, resolvePlayerId } = buildPlayerIdResolvers(ss);

  const leaderMap = {};
  const leaderRows = ss.getSheetByName(SHEETS.LEADERS) ?
    ss.getSheetByName(SHEETS.LEADERS).getDataRange().getValues().slice(1) : [];
  leaderRows.forEach(r => { if (r[0]) leaderMap[String(r[0])] = `${r[1]} - ${r[2] || ''}`.trim(); });

  // Read the season's stored podium blocks from the Awards sheet ONCE. All
  // five awards share this single data read; each block is then materialized
  // from the in-memory rows (awards cost 1 sheet read, not 10).
  const awardsSheet = ss.getSheetByName(SHEETS.AWARDS);
  const awardsData = (awardsSheet && awardsSheet.getLastRow() > 1)
    ? awardsSheet.getDataRange().getValues().slice(1) : [];
  const rulerBlockRaw = materializeBlock(awardsData, targetSeasonId, AWARD_NAMES.RULER, playerMap);
  const hopeBlockRaw = materializeBlock(awardsData, targetSeasonId, AWARD_NAMES.HOPE, playerMap);
  const schemerBlockRaw = materializeBlock(awardsData, targetSeasonId, AWARD_NAMES.SCHEMER, playerMap);
  const ambassadorBlockRaw = materializeBlock(awardsData, targetSeasonId, AWARD_NAMES.AMBASSADOR, playerMap);
  const hunterBlockRaw = materializeBlock(awardsData, targetSeasonId, AWARD_NAMES.HUNTER, playerMap);

  // The Most-Played leader board is intentionally live (it is not an award), so
  // LeaderVotes is always scanned. OpponentVotes / the Schemer tally are only
  // needed as live fallbacks when the corresponding podium block is missing, so
  // they are skipped entirely when the stored award is present.
  const { leaderCounts, playerLeaders, opponentCounts } = computeVoteTallies(
    ss, targetSeasonId,
    { needPlayerLeaders: !schemerBlockRaw, needOpponentCounts: !ambassadorBlockRaw }
  );
  const leaderLeaderboard = assignStandardRanks(
    Object.keys(leaderCounts)
      .map(lId => ({ id: lId, name: leaderMap[lId] || lId, count: leaderCounts[lId] }))
      .sort((a, b) => b.count - a.count),
    'count'
  ).map(e => ({ id: e.id, name: e.name, displayRank: e.displayRank, score: `${e.count} Plays`, subtitle: null }));

  // Fallback sources used only when a season's podium block is missing or has
  // no filled rows (active season before its first materialization, a site
  // outage, or votes not yet present).
  const seasonNumber = seasonNumberFrom(targetSeasonId);
  const midRound = seasonLength > 0 ? Math.floor(seasonLength / 2) : 0;
  const failoverRound = failoverRoundFor(settings, seasonLength, isLive);

  function rankedBoard(counts, toEntry, formatScore) {
    return assignStandardRanks(
      Object.keys(counts)
        .map(k => toEntry(k))
        .sort((a, b) => b.count - a.count),
      'count'
    ).map(e => ({ id: e.id, name: e.name, displayRank: e.displayRank, score: formatScore(e), subtitle: null }));
  }

  function fetchTopRankEntries(roundNumber, limit) {
    const top = limit || 3;
    if (!seasonNumber || !roundNumber) return null;
    const pod = computeRulerPodium(seasonNumber, roundNumber, resolvePlayerId, req);
    if (pod.length === 0) return null;
    return pod.map(e => ({
      id: e.id,
      name: playerMap[e.id] || e.id,
      displayRank: pod.indexOf(e) + 1,
      score: `${e.score} Pts`,
      subtitle: null
    }));
  }

  function fetchTopClimbEntries(mid, fin, limit) {
    const top = limit || 3;
    if (!seasonNumber || !mid) return null;
    const pod = computeHopePodium(seasonNumber, mid, fin || mid, resolvePlayerId, req);
    if (pod.length === 0) return null;
    const ranked = assignStandardRanks(
      pod.map(r => ({ id: r.id, climbed: r.score })),
      'climbed'
    );
    return ranked.map(e => ({
      id: e.id,
      name: playerMap[e.id] || e.id,
      displayRank: e.displayRank,
      score: `+${e.climbed} Climb`,
      subtitle: null
    }));
  }

  // Podium blocks already materialized in the sheet. Each entry carries a raw
  // numeric score; the per-award formatter below turns that into its display.
  function formatBlock(block, fmt) {
    if (!block) return null;
    return block.map(e => ({ id: e.id, name: e.name, displayRank: e.displayRank, score: fmt(e), subtitle: null }));
  }
  const rulerBlock = formatBlock(rulerBlockRaw, (e) => `${e.score} Pts`);
  const hopeBlock = formatBlock(hopeBlockRaw, (e) => `+${e.score} Climb`);
  const schemerBlock = formatBlock(schemerBlockRaw, (e) => `${e.score} Leaders`);
  const ambassadorBlock = formatBlock(ambassadorBlockRaw, (e) => `${e.score} Votes`);
  const hunterBlock = formatBlock(hunterBlockRaw, (e) => (e.score ? `${e.score} 💀` : null));

  // Galactic Ruler: the stored podium (points) when present, else the live site.
  let ruler = rulerBlock;
  if (!ruler) ruler = fetchTopRankEntries(failoverRound, 3);

  // A New Hope: stored podium when present, else the live climb comparison.
  // Live tracking only starts after the midpoint+1 gate.
  let newHope = hopeBlock;
  if (!newHope && seasonLength > 0) {
    const liveReady = isLive && weekInSeason && currentWeek >= midRound + 1;
    if (!isLive || liveReady) {
      newHope = fetchTopClimbEntries(midRound, failoverRound, 3);
    }
  }

  // Galactic Schemer: stored podium, else the live distinct-leader tally.
  const schemerCounts = {};
  Object.keys(playerLeaders).forEach(pId => {
    if (playerLeaders[pId].size > 0) schemerCounts[pId] = playerLeaders[pId].size;
  });
  const schemer = schemerBlock || rankedBoard(
    schemerCounts,
    (pid) => ({ id: pid, name: playerMap[pid] || `Unknown (${pid})`, count: schemerCounts[pid] }),
    (e) => `${e.count} Leaders`
  );

  // Galactic Ambassador: stored podium, else the live vote tally. Identities
  // stay codenames while within a live voting window (applied to both the
  // materialized block and the live fallback so names never leak while live).
  let ambassador = ambassadorBlock;
  if (!ambassador) {
    ambassador = rankedBoard(opponentCounts, (pid) => ({ id: pid, name: playerMap[pid] || pid, count: opponentCounts[pid] }), (e) => `${e.count} Votes`);
  }
  if (isLive) {
    const callsigns = [
      'Gold Leader',
      'Green Leader',
      'Red Leader',
      'Blade Eleven',
      'Rogue One',
      'Phoenix Leader'
    ];
    ambassador.forEach((entry, index) => {
      entry.name = callsigns[index] || `Vanguard-${index + 1}`;
    });
  }

  // Bounty Hunter is manual; hidden while live, shown after close from the
  // stored (owner-filled) block.
  const bountyHunter = isLive ? null : (hunterBlock ? hunterBlock.map(e => ({ ...e })) : []);

  return {
    success: true,
    seasonId: targetSeasonId,
    seasonName: getSeasonName(targetSeasonId, req),
    isActiveSeason: isActiveSeason,
    leaderLeaderboard: leaderLeaderboard,
    schemer: schemer,
    ambassador: ambassador,
    ruler: ruler,
    newHope: newHope,
    bountyHunter: bountyHunter
  };
}

function handleGetMySeasonStats(requestedSeasonId, userEmail, req) {
  const linkedPlayer = findPlayerByGoogleEmail(userEmail, req);
  if (!linkedPlayer) {
    userError('Link your account first.');
  }

  const settings = getSettings(req);
  const activeSeasonId = String(settings.ACTIVE_SEASON_ID || '');
  const seasonId = requestedSeasonId ? String(requestedSeasonId) : activeSeasonId;
  const isCurrentActiveSeason = (String(seasonId) === activeSeasonId);
  const ss = getSpreadsheetCached(req);

  // Awards won this season, from the podium blocks in the Awards sheet.
  // For every award (including Bounty Hunter, which is owner-filled) the winners
  // are all non-empty rows sharing the block's max SCORE. Galactic Ruler is the
  // exception: only the max-SCORE row with the LOWEST sheet row wins (rank 1 is
  // always written first), because there can be only one Ruler.
  const awardsWon = [];
  const awardsSheet = ss.getSheetByName(SHEETS.AWARDS);
  if (awardsSheet && awardsSheet.getLastRow() > 1) {
    const grouped = {};
    awardsSheet.getDataRange().getValues().slice(1).forEach((r, i) => {
      if (String(r[0]) !== seasonId) return;
      const award = String(r[1] || '');
      const pid = String(r[2] || '').trim();
      if (!award || !pid) return;
      const sc = Number(r[3]);
      const score = Number.isFinite(sc) ? sc : 0;
      const dataIndex = i; // tracks sheet row order (lower = higher on the sheet)
      if (!grouped[award]) grouped[award] = [];
      grouped[award].push({ pid, score, dataIndex });
    });

    Object.keys(grouped).forEach(award => {
      const rows = grouped[award];
      if (award === AWARD_NAMES.RULER) {
        const maxScore = Math.max(...rows.map(x => x.score));
        const winners = rows.filter(x => x.score === maxScore)
          .sort((a, b) => a.dataIndex - b.dataIndex);
        const champion = winners[0];
        if (champion && champion.pid === String(linkedPlayer.id)) awardsWon.push(award);
        return;
      }
      const maxScore = Math.max(...rows.map(x => x.score));
      const championIds = new Set(rows.filter(x => x.score === maxScore).map(x => x.pid));
      if (championIds.has(String(linkedPlayer.id))) awardsWon.push(award);
    });
  }

  // Leaders played this season, computed on demand from raw LeaderVotes rows.
  const leaderNames = {};
  getSeasonLeaders(req).forEach(l => { leaderNames[l.id] = l.name; });

  const counts = {};
  const lvSheet = ss.getSheetByName(SHEETS.LEADER_VOTES);
  if (lvSheet && lvSheet.getLastRow() > 1) {
    lvSheet.getDataRange().getValues().slice(1).forEach(r => {
      if (String(r[1]) === seasonId && String(r[3]) === String(linkedPlayer.id)) {
        const lId = String(r[4]);
        if (lId) counts[lId] = (counts[lId] || 0) + 1;
      }
    });
  }

  const leaders = Object.keys(counts).map(lId => ({
    id: lId,
    name: leaderNames[lId] || lId,
    plays: counts[lId]
  })).sort((a, b) => b.plays - a.plays);

  return {
    success: true,
    seasonId: seasonId,
    isActiveSeason: isCurrentActiveSeason,
    awardsWon: awardsWon,
    leaders: leaders
  };
}

function assignStandardRanks(sortedList, scoreKey) {
  let currentRank = 1;
  return sortedList.map((item, index, array) => {
    if (index > 0 && item[scoreKey] < array[index - 1][scoreKey]) {
      currentRank = index + 1; // Skip ranks for ties (e.g., 1, 1, 3)
    }
    return { ...item, displayRank: currentRank };
  });
}

/* ============================================================================
 * AUTOMATION & LEAGUE LIFECYCLE
 * ============================================================================ */

function advanceLeagueWeek() {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const ss = getSpreadsheet();
    const settingsSheet = ss.getSheetByName(SHEETS.SETTINGS);
    const settings = getSettings();
    
    if (!isVotingOpen(settings)) {
      return { success: true, message: 'Voting closed.' };
    }

    const seasonId = String(settings.ACTIVE_SEASON_ID || '');
    const currentWeekNum = parseWeek(settings.CURRENT_WEEK);
    const seasonLength = getSeasonLength();

    if (currentWeekNum >= seasonLength) {
      // Capture the final podium BEFORE flipping the settings, so
      // failoverRoundFor still resolves the current (final) round cleanly.
      refreshAwardsPodium(seasonId);
      updateSetting(settingsSheet, 'VOTING_OPEN', 'FALSE');
      updateSetting(settingsSheet, 'CURRENT_WEEK', 'Season Ended');
      return { success: true, message: `Season ${seasonLength} completed, voting closed, awards calculated.` };
    }

    const nextWeekNum = currentWeekNum + 1;
    const nextWeekStr = `Week ${nextWeekNum}`;

    updateSetting(settingsSheet, 'CURRENT_WEEK', nextWeekStr);
    updateSetting(settingsSheet, 'VOTING_OPEN', 'TRUE');

    return { success: true, newWeek: nextWeekStr };

  } catch (err) {
    console.error('Failed to advance week: ' + err.toString());
    throw err;
  } finally {
    lock.releaseLock();
  }
}

const AWARD_NAMES = {
  AMBASSADOR: 'Galactic Ambassador',
  SCHEMER: 'Galactic Schemer',
  RULER: 'Galactic Ruler',
  HOPE: 'A New Hope',
  HUNTER: 'Bounty Hunter'
};

// Builds the site-player -> Players-id resolver used by the award computation:
// melee name (Players col C == the site's playerUsername) first, then display
// name (col B). Returns null when there is no match.
function buildPlayerIdResolvers(ss) {
  const playerIdByMelee = {};
  const playerIdByName = {};
  const playerNames = {};
  const playerRows = ss.getSheetByName(SHEETS.PLAYERS) ?
    ss.getSheetByName(SHEETS.PLAYERS).getDataRange().getValues().slice(1) : [];
  playerRows.forEach(r => {
    const id = String(r[0]);
    if (!id) return;
    playerNames[id] = String(r[1]);
    if (r[2]) playerIdByMelee[String(r[2]).trim().toLowerCase()] = id;
    if (r[1]) playerIdByName[String(r[1]).trim().toLowerCase()] = id;
  });
  return {
    resolvePlayerId: (entry) => {
      const byMelee = playerIdByMelee[String(entry.username || '').trim().toLowerCase()];
      if (byMelee) return byMelee;
      return playerIdByName[String(entry.name || '').trim().toLowerCase()] || null;
    },
    playerNames
  };
}

// Fetches a season's standings for a given round from the SWU league site and
// returns [{ username, name, rank, points }, ...], or null if the site is
// unreachable / parse fails (safe fallthrough).
function fetchSeasonStandings(seasonNumber, roundNumber, req) {
  return reqCached(req, 'standings-' + seasonNumber + '-' + roundNumber, () => {
    const base = getConfig('SCRAPE_URL') || 'https://stockholm.sw-unlimited.com/';
    const url = `${base}season/${seasonNumber}/round/${roundNumber}`;

    let html;
    try {
      const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
      if (response.getResponseCode() !== 200) return null;
      html = response.getContentText();
    } catch (err) {
      console.error(`[Awards] Failed to fetch standings ${url}: ${err}`);
      return null;
    }
    if (!html) return null;

    // The page embeds a SvelteKit data payload containing a "standings" array.
    // Entries are JS object literals with UNQUOTED keys (e.g. {id:13192,rank:1}),
    // so they are not valid JSON. We extract each object and read fields by regex.
    const arrayMatch = html.match(/standings:\[([\s\S]*?)\],seasonWinCounts/);
    if (!arrayMatch) return null;

    const standings = [];
    // Match each curly-braced object literal inside the standings array.
    const objRe = /\{([^{}]*)\}/g;
    let objMatch;
    while ((objMatch = objRe.exec(arrayMatch[1])) !== null) {
      const block = objMatch[1];
      const grab = (key) => {
        const m = block.match(new RegExp(key + ':([^,]*)'));
        if (!m) return '';
        return m[1].trim().replace(/^"|"$/g, '');
      };
      const user = grab('playerUsername');
      if (!user) continue;
      standings.push({
        username: user,
        name: grab('playerName'),
        rank: Number(grab('rank')),
        points: Number(grab('points'))
      });
    }

    if (standings.length === 0) {
      console.error(`[Awards] Failed to parse standings ${url}`);
      return null;
    }
    return standings;
  });
}

// Formats a date as YYYY-MM-DD so the Seasons DATE column matches the existing
// ISO-string rows instead of a raw Date object.
function formatISODate(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function startNewSeason() {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const ss = getSpreadsheet();
    const seasonsSheet = ss.getSheetByName(SHEETS.SEASONS);
    const rows = seasonsSheet.getDataRange().getValues().slice(1);

    let maxSeasonNum = 0;
    rows.forEach(r => {
      if (r[0] !== undefined && r[0] !== '') {
        const num = parseInt(String(r[0]).replace(/\D/g, ''), 10);
        if (!isNaN(num) && num > maxSeasonNum) {
          maxSeasonNum = num;
        }
      }
    });

    const nextSeasonId = maxSeasonNum + 1;
    const nextSeasonName = `Season ${nextSeasonId}`;

    seasonsSheet.appendRow([nextSeasonId, nextSeasonName, formatISODate(new Date())]);

    const settingsSheet = ss.getSheetByName(SHEETS.SETTINGS);
    updateSetting(settingsSheet, 'ACTIVE_SEASON_ID', nextSeasonId);
    updateSetting(settingsSheet, 'CURRENT_WEEK', 'Week 1');
    updateSetting(settingsSheet, 'VOTING_OPEN', 'TRUE');

    return { success: true, seasonId: nextSeasonId, seasonName: nextSeasonName };
  } finally {
    lock.releaseLock();
  }
}

function syncPlayersFromWebsite() {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const settings = getSettings();
    const votingOpen = isVotingOpen(settings);
    const activeSeasonId = String(settings.ACTIVE_SEASON_ID || '');

    if (!votingOpen || !activeSeasonId) return;

  const url = getConfig('SCRAPE_URL') || 'https://stockholm.sw-unlimited.com/';

  let html;
  try {
    const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });

    // Treat non-200 responses (down, maintenance, moved, etc.) as "no sync" so we
    // never act on an error page.
    const code = response.getResponseCode();
    if (code !== 200) {
      console.error(`[SyncPlayers] Site returned HTTP ${code}; skipping player sync.`);
      return;
    }

    html = response.getContentText();
  } catch (err) {
    console.error('[SyncPlayers] Failed to reach player site; skipping sync: ' + err);
    // Safe fallthrough: leave the existing roster untouched rather than crashing.
    return;
  }

  const regex = /<a\s+href="\/player\/([^"]+)">([^<]+)<\/a>/gi;
  let match;
  const scrapedPlayers = new Map();

  while ((match = regex.exec(html)) !== null) {
    const meleeHandle = decodeURIComponent(match[1].trim());
    const displayName = match[2].trim();
    if (meleeHandle) {
      scrapedPlayers.set(meleeHandle.toLowerCase(), { meleeName: meleeHandle, name: displayName });
    }
  }

  if (scrapedPlayers.size === 0) {
    console.error('[SyncPlayers] Site reachable but no players parsed; skipping sync.');
    return;
  }

  const ss = getSpreadsheet();
  const playerSheet = ss.getSheetByName(SHEETS.PLAYERS);
  const rows = playerSheet.getDataRange().getValues();
  
  const existingMeleeMap = new Map();
  let maxIdNum = 0;
  for (let i = 1; i < rows.length; i++) {
    const existingMelee = String(rows[i][2] || '').toLowerCase().trim();
    if (existingMelee) {
      existingMeleeMap.set(existingMelee, { rowIndex: i + 1, playerId: String(rows[i][0]) });
    }
    const num = parseInt(String(rows[i][0] || '').replace(/\D/g, ''), 10);
    if (!isNaN(num) && num > maxIdNum) maxIdNum = num;
  }

  let nextIdNumber = maxIdNum + 1;

  scrapedPlayers.forEach((playerData, key) => {
    if (existingMeleeMap.has(key)) {
      const record = existingMeleeMap.get(key);
      const currentDisplayName = String(rows[record.rowIndex - 1][1] || '').trim();
      if (playerData.name && currentDisplayName !== playerData.name) {
        playerSheet.getRange(record.rowIndex, 2).setValue(playerData.name);
      }
    } else {
      const newId = 'P' + String(nextIdNumber).padStart(3, '0');
      playerSheet.appendRow([newId, playerData.name, playerData.meleeName, '', 'TRUE']);
      nextIdNumber++;
    }
  });

  // Refresh the active season's award podium after the roster sync (weekly,
  // while voting is open). Runs under the already-held script lock.
  refreshAwardsPodium(activeSeasonId);
  } finally {
    lock.releaseLock();
  }
}
