/**
 * ============================================================================
 * SCRIPT 1: BACKEND & DATABASE ENGINE
 * Executes as: ME (USER_DEPLOYING)
 * Access: ANYONE_ANONYMOUS (anonymous OK; protected by API_SECRET)
 * ============================================================================
 */

// Config loaded from Apps Script Script Properties at runtime.
// Set these properties in the Apps Script editor (Project Settings -> Script Properties)
// or via the utilities below. They are NOT committed to the repo.
function getConfig(key, fallback) {
  const val = PropertiesService.getScriptProperties().getProperty(key);
  return val || fallback;
}

const SPREADSHEET_ID = getConfig('SPREADSHEET_ID');

// Secret shared with the frontend proxy (Script 2). Every request must present it
// so that only our own web app can talk to this backend. Never exposed to browsers.
const API_SECRET = getConfig('API_SECRET', '');

const SHEETS = {
  SETTINGS: 'Settings',
  PLAYERS: 'Players',
  LEADERS: 'Leaders',
  SEASONS: 'Seasons',
  LEADER_VOTES: 'LeaderVotes',
  OPPONENT_VOTES: 'OpponentVotes',
  AWARDS: 'Awards'
};

function getSpreadsheet() {
  if (!SPREADSHEET_ID) {
    throw new Error('Configuration error: SPREADSHEET_ID is missing. Check your .env / deployment environment.');
  }
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

/**
 * Web App Endpoint: Receives proxy API requests from Script 2.
 */
function userError(msg) { const e = new Error(msg); e.userMessage = msg; throw e; }

function doPost(e) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return createJsonResponse({ success: false, error: 'Database is busy. Please try again.' });
  }

  let action = '';
  try {
    const payload = JSON.parse(e.postData.contents);
    action = payload.action;
    const userEmail = String(payload.userEmail || '').toLowerCase().trim();

    if (!userEmail) throw new Error('User identity missing.');

    // Reject any request that doesn't carry our shared secret. This prevents
    // third parties who discover the public URL from calling the API directly.
    if (String(payload.apiSecret) !== String(API_SECRET)) {
      console.warn(`[API] Unauthorized attempt: action=${action || '?'} userEmail=${userEmail || 'unset'}`);
      return createJsonResponse({ success: false, error: 'Unauthorized.' });
    }

    let result = {};

    if (action === 'getAppData') {
      result = handleGetAppData(userEmail);
    } else if (action === 'linkGoogleAccount') {
      result = handleLinkGoogleAccount(payload.playerId, userEmail);
    } else if (action === 'submitVote') {
      result = handleSubmitVote(payload, userEmail);
    } else if (action === 'getLeaderboardData') {
      result = handleGetLeaderboardData(payload.seasonId);
    } else if (action === 'getMySeasonStats') {
      result = handleGetMySeasonStats(payload.seasonId, userEmail);
    } else {
      throw new Error('Invalid action requested.');
    }

    return createJsonResponse({ success: true, data: result });

  } catch (err) {
    console.error('API Error:', err);
    var gen = { getAppData: "Couldn't load your league data. Please try again.",
                linkGoogleAccount: "We couldn't link your account. Please try again.",
                submitVote: "We couldn't submit your vote. Please try again.",
                getLeaderboardData: "Couldn't load the leaderboard. Please try again.",
                getMySeasonStats: "Couldn't load your stats. Please try again."
              }[action] || 'Something went wrong. Please try again.';
    return createJsonResponse({ success: false, error: err.userMessage || gen });
  } finally {
    lock.releaseLock();
  }
}

function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ============================================================================
 * SETTINGS & CONFIGURATION HELPERS
 * ============================================================================ */

function getSettings() {
  const ss = getSpreadsheet();
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
function getSeasonLength() {
  const val = Number(getSettings().SEASON_LENGTH);
  if (!Number.isInteger(val) || val <= 0) {
    throw new Error('SEASON_LENGTH is not set in Settings.');
  }
  return val;
}

/* ============================================================================
 * DATA RETRIEVAL HELPERS
 * ============================================================================ */

function getAllSeasons() {
  const ss = getSpreadsheet();
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
}

function getSeasonName(seasonId) {
  if (!seasonId) return 'Unknown Season';
  const seasons = getAllSeasons();
  const found = seasons.find(x => String(x.id) === String(seasonId));
  if (found && found.name) return found.name;

  const cleanNum = String(seasonId).replace(/\D/g, '');
  return cleanNum ? `Season ${cleanNum}` : `Season ${seasonId}`;
}

function getSeasonPlayers() {
  const ss = getSpreadsheet();
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
}

function getUnlinkedPlayers() {
  const players = getSeasonPlayers();
  return players.filter(p => !p.email);
}

function getSeasonLeaders() {
  const ss = getSpreadsheet();
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
}

function findPlayerByGoogleEmail(email) {
  if (!email) return null;
  const ss = getSpreadsheet();
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
}

function hasSubmittedThisWeek(playerId, seasonId, weekVal) {
  const ss = getSpreadsheet();
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

function handleGetAppData(userEmail) {
  const settings = getSettings();
  const activeSeasonId = String(settings.ACTIVE_SEASON_ID || '');
  const linkedPlayer = findPlayerByGoogleEmail(userEmail);
  console.info(`[AppData] userEmail=${userEmail} linked=${Boolean(linkedPlayer)}`);
  const currentWeek = parseWeek(settings.CURRENT_WEEK);
  const votingOpen = isVotingOpen(settings);

  const allSeasons = getAllSeasons();

  const data = {
    settings: {
      activeSeasonId: activeSeasonId,
      currentWeek: `Week ${currentWeek}`,
      votingOpen: votingOpen
    },
    seasonId: activeSeasonId,
    seasonName: getSeasonName(activeSeasonId),
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
    data.players = getSeasonPlayers();
    data.leaders = getSeasonLeaders();
    const submitted = hasSubmittedThisWeek(linkedPlayer.id, activeSeasonId, currentWeek);
    data.alreadySubmitted = submitted;
    data.alreadyVoted = submitted;
    data.hasVoted = submitted;
  } else {
    data.unlinkedPlayers = getUnlinkedPlayers();
  }

  return data;
}

function handleLinkGoogleAccount(playerId, email) {
  if (!playerId || !email) {
    userError('Missing Player Selection or User Email.');
  }
  console.info(`[Link] attempt email=${email} playerId=${playerId}`);

  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(SHEETS.PLAYERS);
  const rows = sheet.getDataRange().getValues();

  const existing = findPlayerByGoogleEmail(email);
  if (existing) {
    if (existing.id === String(playerId)) {
      console.info(`[Link] already-linked email=${email} playerId=${playerId}`);
      return { player: existing, linkedPlayer: existing };
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

      const settings = getSettings();
      const activeSeasonId = String(settings.ACTIVE_SEASON_ID || '');
      const currentWeek = parseWeek(settings.CURRENT_WEEK);

      return {
        success: true,
        player: playerObj,
        linkedPlayer: playerObj,
        players: getSeasonPlayers(),
        leaders: getSeasonLeaders(),
        alreadyVoted: hasSubmittedThisWeek(playerObj.id, activeSeasonId, currentWeek)
      };
    }
  }

  throw new Error('Player ID not found in master directory.');
}

function handleSubmitVote(payload, email) {
  const settings = getSettings();

  if (!isVotingOpen(settings)) {
    userError('Voting is currently closed for this week.');
  }

  const player = findPlayerByGoogleEmail(email);
  if (!player || (player.active !== undefined && !player.active)) {
    console.warn(`[Vote] REJECTED unknown/inactive email=${email} playerId=${player ? player.id : 'none'}`);
    userError('Identity unlinked or inactive. Please link your player account.');
  }

  const seasonId = String(settings.ACTIVE_SEASON_ID || '');
  const week = parseWeek(settings.CURRENT_WEEK);

  if (hasSubmittedThisWeek(player.id, seasonId, week)) {
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

  const ss = getSpreadsheet();
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

function handleGetLeaderboardData(requestedSeasonId) {
  const settings = getSettings();
  const activeSeasonId = String(settings.ACTIVE_SEASON_ID || '');
  const targetSeasonId = requestedSeasonId ? String(requestedSeasonId) : activeSeasonId;

  const isActiveSeason = (String(targetSeasonId) === activeSeasonId);
  const votingOpen = isVotingOpen(settings);
  // "Live" tracking: only while this season is the active one AND voting is
  // open. The board flips to the award / final-round view the moment voting
  // closes, even before startNewSeason resets the settings.
  const isLive = isActiveSeason && votingOpen;

  let seasonLength = 0;
  try { seasonLength = getSeasonLength(); } catch (e) { /* SEASON_LENGTH not set */ }
  const currentWeek = parseWeek(settings.CURRENT_WEEK);
  const weekInSeason = seasonLength > 0 && currentWeek >= 1 && currentWeek <= seasonLength;

  const ss = getSpreadsheet();

  const playerMap = {};
  const idByMelee = {};
  const idByName = {};
  const playerRows = ss.getSheetByName(SHEETS.PLAYERS) ?
    ss.getSheetByName(SHEETS.PLAYERS).getDataRange().getValues().slice(1) : [];
  playerRows.forEach(r => {
    const id = String(r[0]);
    if (!id) return;
    playerMap[id] = String(r[1]);
    if (r[2]) idByMelee[String(r[2]).trim().toLowerCase()] = id;
    if (r[1]) idByName[String(r[1]).trim().toLowerCase()] = id;
  });
  // Matches the site's playerUsername to a Players melee name (col C), falling
  // back to the display name (col B); null when the player is not tracked.
  const resolveSiteEntry = (entry) =>
    idByMelee[String(entry.username || '').trim().toLowerCase()] ||
    idByName[String(entry.name || '').trim().toLowerCase()] ||
    null;

  const leaderMap = {};
  const leaderRows = ss.getSheetByName(SHEETS.LEADERS) ?
    ss.getSheetByName(SHEETS.LEADERS).getDataRange().getValues().slice(1) : [];
  leaderRows.forEach(r => { if (r[0]) leaderMap[String(r[0])] = `${r[1]} - ${r[2] || ''}`.trim(); });

  // Awards already recorded for the target season (written at season close).
  // Only filled rows count; an empty placeholder falls through to the failover
  // below so the board can still show a live value.
  const seasonAwards = {};
  const awardsSheet = ss.getSheetByName(SHEETS.AWARDS);
  if (awardsSheet && awardsSheet.getLastRow() > 1) {
    awardsSheet.getDataRange().getValues().slice(1).forEach(r => {
      if (String(r[0]) !== targetSeasonId) return;
      const award = String(r[1] || '');
      const pid = String(r[2] || '').trim();
      if (award && pid) {
        if (!seasonAwards[award]) seasonAwards[award] = [];
        seasonAwards[award].push(pid);
      }
    });
  }

  // Vote-based tallies feeding the failovers and the tracked stats.
  const leaderCounts = {};
  const playerLeaders = {};
  const lvSheet = ss.getSheetByName(SHEETS.LEADER_VOTES);
  if (lvSheet && lvSheet.getLastRow() > 1) {
    lvSheet.getDataRange().getValues().slice(1).forEach(r => {
      if (String(r[1]) !== targetSeasonId) return;
      const lId = String(r[4]);
      const pId = String(r[3]);
      if (lId) leaderCounts[lId] = (leaderCounts[lId] || 0) + 1;
      if (pId && lId) {
        if (!playerLeaders[pId]) playerLeaders[pId] = new Set();
        playerLeaders[pId].add(lId);
      }
    });
  }

  const opponentCounts = {};
  const ovSheet = ss.getSheetByName(SHEETS.OPPONENT_VOTES);
  if (ovSheet && ovSheet.getLastRow() > 1) {
    ovSheet.getDataRange().getValues().slice(1).forEach(r => {
      if (String(r[1]) === targetSeasonId) {
        const pId = String(r[3]);
        if (pId) opponentCounts[pId] = (opponentCounts[pId] || 0) + 1;
      }
    });
  }

  // Ranks a raw { id -> count } tally and formats each entry for the UI.
  function rankedBoard(counts, toEntry, formatScore) {
    return assignStandardRanks(
      Object.keys(counts)
        .map(k => toEntry(k))
        .sort((a, b) => b.count - a.count),
      'count'
    ).map(e => ({ id: e.id, name: e.name, displayRank: e.displayRank, score: formatScore(e), subtitle: null }));
  }

  const leaderLeaderboard = rankedBoard(
    leaderCounts,
    (lId) => ({ id: lId, name: leaderMap[lId] || lId, count: leaderCounts[lId] }),
    (e) => `${e.count} Plays`
  );

  // The vote-failover sources for Schemer / Ambassador.
  const schemerCounts = {};
  Object.keys(playerLeaders).forEach(pId => {
    if (playerLeaders[pId].size > 0) schemerCounts[pId] = playerLeaders[pId].size;
  });
  const schemerFailover = rankedBoard(
    schemerCounts,
    (pid) => ({ id: pid, name: playerMap[pid] || `Unknown (${pid})`, count: schemerCounts[pid] }),
    (e) => `${e.count} Leaders`
  );
  const ambassadorFailover = rankedBoard(
    opponentCounts,
    (pid) => ({ id: pid, name: playerMap[pid] || pid, count: opponentCounts[pid] }),
    (e) => `${e.count} Votes`
  );

  // Awards-first: when the season has a filled award row its winner(s) render
  // as "Awarded"; otherwise the section falls back to the live/vote source.
  function awardedEntries(award) {
    const ids = seasonAwards[award];
    if (!ids || ids.length === 0) return null;
    return assignStandardRanks(
      ids.map(id => ({ id: id, name: playerMap[id] || id, count: 1 })),
      'count'
    ).map(e => ({ id: e.id, name: e.name, displayRank: e.displayRank, score: 'Awarded', subtitle: 'Awarded' }));
  }

  // Galactic Schemer: most distinct leaders played (vote failover).
  const schemer = awardedEntries(AWARD_NAMES.SCHEMER) || schemerFailover;

  // Galactic Ambassador: most favorite-opponent votes; identities stay
  // codenames while the season is live, real names are revealed the moment
  // voting closes.
  let ambassador = awardedEntries(AWARD_NAMES.AMBASSADOR);
  if (!ambassador) {
    ambassador = ambassadorFailover.map(e => ({ ...e }));
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
  }

  // Site-based awards. The round that drives them is the settings week while
  // the target is the live active season; once the season has ended (or it is
  // historical) we use the final round, because CURRENT_WEEK belongs to the
  // active season only. "Season Ended" parses to 1, so it can never be
  // distinguished from week 1 numerically — hence the closed->final round rule.
  const seasonNumber = parseInt(targetSeasonId.replace(/\D/g, ''), 10) || null;
  const midRound = seasonLength > 0 ? Math.floor(seasonLength / 2) : 0;
  const failoverRound = isLive && weekInSeason ? currentWeek : seasonLength;

  function fetchRankOneEntries(roundNumber) {
    if (!seasonNumber || !roundNumber) return null;
    const standings = fetchSeasonStandings(seasonNumber, roundNumber);
    if (!standings || standings.length === 0) return null;
    const topRank = Math.min(...standings.map(s => s.rank));
    if (topRank === Infinity || topRank <= 0) return null;
    const entries = standings
      .filter(s => s.rank === topRank)
      .map(s => resolveSiteEntry(s))
      .filter(Boolean)
      .map(id => ({ id: id, name: playerMap[id] || id, score: `Rank #${topRank}`, subtitle: null }));
    return entries.length ? entries : null;
  }

  function fetchNewHopeEntries(mid, fin) {
    if (!seasonNumber || !mid) return null;
    const midStandings = fetchSeasonStandings(seasonNumber, mid);
    const finStandings = fetchSeasonStandings(seasonNumber, fin || mid);
    if (!midStandings || !finStandings || midStandings.length === 0 || finStandings.length === 0) return null;
    const midRank = {};
    midStandings.forEach(s => { midRank[String(s.username || s.name)] = s.rank; });
    const climbs = finStandings
      .filter(s => s.username && midRank[String(s.username)] !== undefined)
      .map(s => ({ entry: s, climbed: midRank[String(s.username)] - s.rank }));
    if (climbs.length === 0) return null;
    const best = Math.max(...climbs.map(c => c.climbed));
    if (best <= 0) return null;
    const entries = climbs
      .filter(c => c.climbed === best)
      .map(c => resolveSiteEntry(c.entry))
      .filter(Boolean)
      .map(id => ({ id: id, name: playerMap[id] || id, score: `+${best} Climb`, subtitle: null }));
    return entries.length ? entries : null;
  }

  // Galactic Ruler: site rank-1 for the current week while live, the final
  // round once the season has ended.
  let ruler = awardedEntries(AWARD_NAMES.RULER);
  if (!ruler) ruler = fetchRankOneEntries(failoverRound);

  // A New Hope: most places climbed between the midpoint round and the
  // comparison round. Live tracking starts the week after the midpoint
  // (`floor(SEASON_LENGTH / 2) + 1`); closed/historical seasons use the final
  // round.
  let newHope = awardedEntries(AWARD_NAMES.HOPE);
  if (!newHope && seasonLength > 0) {
    const liveReady = isLive && weekInSeason && currentWeek >= midRound + 1;
    if (!isLive || liveReady) {
      newHope = fetchNewHopeEntries(midRound, failoverRound);
    }
  }

  // Bounty Hunter exists only in the Awards record (manual entry) and only
  // after the season has ended; it is never computed from site/vote data.
  const bountyHunter = isLive ? null : (awardedEntries(AWARD_NAMES.HUNTER) || []);

  return {
    success: true,
    seasonId: targetSeasonId,
    seasonName: getSeasonName(targetSeasonId),
    isActiveSeason: isActiveSeason,
    leaderLeaderboard: leaderLeaderboard,
    schemer: schemer,
    ambassador: ambassador,
    ruler: ruler,
    newHope: newHope,
    bountyHunter: bountyHunter
  };
}

function handleGetMySeasonStats(requestedSeasonId, userEmail) {
  const linkedPlayer = findPlayerByGoogleEmail(userEmail);
  if (!linkedPlayer) {
    userError('Link your account first.');
  }

  const settings = getSettings();
  const activeSeasonId = String(settings.ACTIVE_SEASON_ID || '');
  const seasonId = requestedSeasonId ? String(requestedSeasonId) : activeSeasonId;
  const isCurrentActiveSeason = (String(seasonId) === activeSeasonId);
  const ss = getSpreadsheet();

  // Awards won this season (from the Awards record written at season close).
  const awardsWon = [];
  const awardsSheet = ss.getSheetByName(SHEETS.AWARDS);
  if (awardsSheet && awardsSheet.getLastRow() > 1) {
    awardsSheet.getDataRange().getValues().slice(1).forEach(r => {
      if (String(r[0]) === seasonId && String(r[2]) === String(linkedPlayer.id)) {
        awardsWon.push(String(r[1]));
      }
    });
  }

  // Leaders played this season, computed on demand from raw LeaderVotes rows.
  const leaderNames = {};
  getSeasonLeaders().forEach(l => { leaderNames[l.id] = l.name; });

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
      updateSetting(settingsSheet, 'VOTING_OPEN', 'FALSE');
      updateSetting(settingsSheet, 'CURRENT_WEEK', 'Season Ended');
      calculateSeasonAwards(seasonId);
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

function calculateSeasonAwards(seasonId) {
  const ss = getSpreadsheet();
  const awardsSheet = ss.getSheetByName(SHEETS.AWARDS);
  if (!awardsSheet) return;

  const seasonKey = String(seasonId);

  // Idempotency: each award is recorded at most once per season. Re-running the
  // close never duplicates already-written rows, but a row that is still empty
  // (site was down, no votes, etc.) can be filled in later by
  // backfillSeasonAwards rather than by rewriting it here.
  const alreadyWritten = new Set();
  const existingAwardRows = awardsSheet.getDataRange().getValues().slice(1);
  existingAwardRows.forEach(r => {
    if (String(r[0]) === seasonKey && r[1]) alreadyWritten.add(String(r[1]));
  });

  const winners = computeAwardWinners(seasonKey);
  const rows = [];

  // Every award always gets a row: the resolved winner(s) when we have them,
  // otherwise an empty placeholder [seasonId, award, ''] whose playerId is
  // filled in later (manually for Bounty Hunter, via backfill for the rest).
  [
    AWARD_NAMES.AMBASSADOR,
    AWARD_NAMES.SCHEMER,
    AWARD_NAMES.RULER,
    AWARD_NAMES.HOPE,
    AWARD_NAMES.HUNTER
  ].forEach(award => {
    if (alreadyWritten.has(award)) return;
    if (award === AWARD_NAMES.HUNTER) {
      rows.push([seasonKey, award, '']);
      return;
    }
    const ids = (winners[award] || []).filter(Boolean);
    if (ids.length === 0) {
      rows.push([seasonKey, award, '']);
      return;
    }
    ids.forEach(id => rows.push([seasonKey, award, String(id)]));
  });

  if (rows.length > 0) {
    awardsSheet.getRange(awardsSheet.getLastRow() + 1, 1, rows.length, 3)
      .setValues(rows);
  }

  // Always sweep the other tracked seasons afterwards so that a previous close
  // that left empty placeholders fine ones now that the site is reachable.
  // The season that just closed is excluded — its rows were written above.
  return backfillSeasonAwards(seasonKey, { lockAlreadyHeld: true });
}

// Computes this season's award winners (nothing is written). Returns
//   { 'Galactic Ambassador': [playerId, ...], 'Galactic Schemer': [...],
//     'Galactic Ruler': [...], 'A New Hope': [...] }
// where each list holds EVERY player tied for the top score, and `[]` means no
// winner resolved (no votes / site unreachable). Bounty Hunter is never
// computed — it has no data source and is always manual. Results are memoized
// per season for the current execution; pass `ctx` ({ cache: {} }) to share one
// memo across several calls (backfills entire Seasons tab with a single site
// fetch per season).
function computeAwardWinners(seasonId, ctx) {
  const context = ctx || { cache: {} };
  const key = String(seasonId);
  if (context.cache[key]) return context.cache[key];
  const winners = computeAwardWinnersUncached(key);
  context.cache[key] = winners;
  return winners;
}

function computeAwardWinnersUncached(seasonKey) {
  const ss = getSpreadsheet();
  const seasonNumber = parseInt(seasonKey.replace(/\D/g, ''), 10) || null;
  const seasonLength = getSeasonLength();

  const winners = {
    'Galactic Ambassador': [],
    'Galactic Schemer': [],
    'Galactic Ruler': [],
    'A New Hope': []
  };

  // Galactic Ambassador: player with the most favorite-opponent votes.
  const ovRows = ss.getSheetByName(SHEETS.OPPONENT_VOTES) ?
    ss.getSheetByName(SHEETS.OPPONENT_VOTES).getDataRange().getValues().slice(1) : [];
  const favCounts = {};
  ovRows.forEach(r => {
    if (String(r[1]) === seasonKey) {
      const oppId = String(r[3]);
      if (oppId) favCounts[oppId] = (favCounts[oppId] || 0) + 1;
    }
  });
  winners['Galactic Ambassador'] = maxKeys(favCounts);

  // Galactic Schemer: player with the most distinct leaders played.
  const distinct = {};
  const lvRows = ss.getSheetByName(SHEETS.LEADER_VOTES) ?
    ss.getSheetByName(SHEETS.LEADER_VOTES).getDataRange().getValues().slice(1) : [];
  lvRows.forEach(r => {
    if (String(r[1]) !== seasonKey) return;
    const pId = String(r[3]);
    const lId = String(r[4]);
    if (!pId || !lId) return;
    if (!distinct[pId]) distinct[pId] = new Set();
    distinct[pId].add(lId);
  });
  const schemerCounts = {};
  Object.keys(distinct).forEach(pId => { schemerCounts[pId] = distinct[pId].size; });
  winners['Galactic Schemer'] = maxKeys(schemerCounts);

  // Site-based awards. Round-based standings can fail if the site is
  // unreachable; an empty list just means a placeholder row is written rather
  // than failing the whole close.
  if (seasonNumber && isFinite(seasonNumber)) {
    const { resolvePlayerId } = buildPlayerIdResolvers(ss);

    const finalStandings = fetchSeasonStandings(seasonNumber, seasonLength);

    if (finalStandings && finalStandings.length) {
      // Galactic Ruler: best final placing (all players tied for rank 1).
      const topRank = Math.min(...finalStandings.map(s => s.rank));
      if (topRank !== Infinity && topRank > 0) {
        winners['Galactic Ruler'] = finalStandings
          .filter(s => s.rank === topRank)
          .map(s => resolvePlayerId(s))
          .filter(Boolean);
      }

      // A New Hope: most places climbed between the midpoint round and the
      // final round, counting only players present in both standings.
      const midStandings = fetchSeasonStandings(seasonNumber, Math.floor(seasonLength / 2));
      if (midStandings && midStandings.length) {
        const midRank = {};
        midStandings.forEach(s => { midRank[String(s.username || s.name)] = s.rank; });

        const climbs = finalStandings
          .filter(s => s.username && midRank[String(s.username)] !== undefined)
          .map(s => ({ entry: s, climbed: midRank[String(s.username)] - s.rank }));

        if (climbs.length) {
          const best = Math.max(...climbs.map(c => c.climbed));
          if (best > 0) {
            winners['A New Hope'] = climbs
              .filter(c => c.climbed === best)
              .map(c => resolvePlayerId(c.entry))
              .filter(Boolean);
          }
        }
      }
    }
  }

  return winners;
}

function maxKeys(counts) {
  const keys = Object.keys(counts);
  if (keys.length === 0) return [];
  let max = -Infinity;
  keys.forEach(k => { if (counts[k] > max) max = counts[k]; });
  if (max <= 0) return [];
  return keys.filter(k => counts[k] === max);
}

// Builds the site-player -> Players-id resolver used by the award computation:
// melee name (Players col C == the site's playerUsername) first, then display
// name (col B). Returns null when there is no match.
function buildPlayerIdResolvers(ss) {
  const playerIdByMelee = {};
  const playerIdByName = {};
  const playerRows = ss.getSheetByName(SHEETS.PLAYERS) ?
    ss.getSheetByName(SHEETS.PLAYERS).getDataRange().getValues().slice(1) : [];
  playerRows.forEach(r => {
    const id = String(r[0]);
    if (!id) return;
    if (r[2]) playerIdByMelee[String(r[2]).trim().toLowerCase()] = id;
    if (r[1]) playerIdByName[String(r[1]).trim().toLowerCase()] = id;
  });
  return {
    resolvePlayerId: (entry) => {
      const byMelee = playerIdByMelee[String(entry.username || '').trim().toLowerCase()];
      if (byMelee) return byMelee;
      return playerIdByName[String(entry.name || '').trim().toLowerCase()] || null;
    }
  };
}

// Fills any non-Bounty-Hunter award row that still has an empty playerId for a
// season listed in the Seasons tab, using the same award computation as the
// close. Bounty Hunter is never touched and filled rows are never rewritten.
// No arg = sweep every tracked season (Run-button friendly); pass
// `excludeSeasonId` to skip one (used after a close). Acquires the script lock
// unless `opts.lockAlreadyHeld` is true (safe when nesting inside
// advanceLeagueWeek / calculateSeasonAwards, which already hold a lock).
function backfillSeasonAwards(excludeSeasonId, opts) {
  const options = opts || {};
  const lock = LockService.getScriptLock();
  if (!options.lockAlreadyHeld) lock.waitLock(10000);
  try {
    return backfillSeasonAwardsUnlocked(excludeSeasonId);
  } finally {
    if (!options.lockAlreadyHeld) lock.releaseLock();
  }
}

function backfillSeasonAwardsUnlocked(excludeSeasonId) {
  const ss = getSpreadsheet();
  const seasonsSheet = ss.getSheetByName(SHEETS.SEASONS);
  if (!seasonsSheet || seasonsSheet.getLastRow() <= 1) return { scanned: 0, written: 0 };

  const trackedSeasonIds = seasonsSheet.getDataRange().getValues().slice(1)
    .map(r => String(r[0]).trim())
    .filter(id => id && id !== String(excludeSeasonId));

  if (trackedSeasonIds.length === 0) return { scanned: 0, written: 0 };

  const awardsSheet = ss.getSheetByName(SHEETS.AWARDS);
  if (!awardsSheet || awardsSheet.getLastRow() <= 1) return { scanned: 0, written: 0 };

  const ctx = { cache: {} };
  const rows = awardsSheet.getDataRange().getValues();
  const fills = [];

  for (let i = 1; i < rows.length; i++) {
    const seasonId = String(rows[i][0]).trim();
    const award = String(rows[i][1] || '').trim();
    const playerId = String(rows[i][2] || '').trim();

    if (!seasonId || !award) continue;
    if (!trackedSeasonIds.includes(seasonId)) continue;
    if (award === AWARD_NAMES.HUNTER) continue;
    if (playerId) continue;

    const ids = (computeAwardWinners(seasonId, ctx)[award] || []).filter(Boolean);
    if (ids.length === 0) continue;
    fills.push({ rowIndex: i + 1, seasonId: seasonId, award: award, ids: ids });
  }

  fills.forEach(f => {
    // The first winner stays in the placeholder row; any additional tied
    // winners are appended as extra rows (Awards rows are keyed by season + award).
    awardsSheet.getRange(f.rowIndex, 3).setValue(String(f.ids[0]));
    const adds = f.ids.slice(1);
    if (adds.length > 0) {
      awardsSheet.getRange(awardsSheet.getLastRow() + 1, 1, adds.length, 3)
        .setValues(adds.map(id => [f.seasonId, f.award, String(id)]));
    }
  });

  return {
    scanned: fills.length,
    written: fills.reduce((n, f) => n + f.ids.length, 0)
  };
}

// Fetches a season's standings for a given round from the SWU league site and
// returns [{ username, name, rank, points }, ...], or null if the site is
// unreachable / parse fails (safe fallthrough).
function fetchSeasonStandings(seasonNumber, roundNumber) {
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
}

function startNewSeason() {
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

  seasonsSheet.appendRow([nextSeasonId, nextSeasonName, new Date()]);

  const settingsSheet = ss.getSheetByName(SHEETS.SETTINGS);
  updateSetting(settingsSheet, 'ACTIVE_SEASON_ID', nextSeasonId);
  updateSetting(settingsSheet, 'CURRENT_WEEK', 'Week 1');
  updateSetting(settingsSheet, 'VOTING_OPEN', 'TRUE');

  return { success: true, seasonId: nextSeasonId, seasonName: nextSeasonName };
}

function syncPlayersFromWebsite() {
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
  for (let i = 1; i < rows.length; i++) {
    const existingMelee = String(rows[i][2] || '').toLowerCase().trim();
    if (existingMelee) {
      existingMeleeMap.set(existingMelee, { rowIndex: i + 1, playerId: String(rows[i][0]) });
    }
  }

  let nextIdNumber = rows.length;

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
}
