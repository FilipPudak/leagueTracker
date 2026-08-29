/**
 * ============================================================================
 * SCRIPT 1: BACKEND & DATABASE ENGINE
 * Executes as: ME
 * Access: ANYONE
 * ============================================================================
 */

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

const SHEETS = {
  SETTINGS: 'Settings',
  PLAYERS: 'Players',
  LEADERS: 'Leaders',
  SEASONS: 'Seasons',
  SEASON_PLAYERS: 'SeasonPlayers',
  SEASON_LEADERS: 'SeasonLeaders',
  LEADER_VOTES: 'LeaderVotes',
  OPPONENT_VOTES: 'OpponentVotes',
  SUBMISSION_LOG: 'SubmissionLog',
  SEASON_SUMMARY: 'SeasonSummary',
  AWARDS: 'Awards'
};

function getSpreadsheet() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

/**
 * Web App Endpoint: Receives proxy API requests from Script 2.
 */
function doPost(e) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return createJsonResponse({ success: false, error: 'Database is busy. Please try again.' });
  }

  try {
    const payload = JSON.parse(e.postData.contents);
    const action = payload.action;
    const userEmail = String(payload.userEmail || '').toLowerCase().trim();

    if (!userEmail) throw new Error('User identity missing.');

    let result = {};

    if (action === 'getAppData' || action === 'getInitialData') {
      result = handleGetAppData(userEmail);
    } else if (action === 'linkGoogleAccount' || action === 'linkAccount') {
      result = handleLinkGoogleAccount(payload.playerId, userEmail);
    } else if (action === 'submitVote') {
      result = handleSubmitVote(payload, userEmail);
    } else if (action === 'getLeaderboardData') {
      result = handleGetLeaderboardData(payload.seasonId);
    } else if (action === 'advanceWeek') {
      result = advanceLeagueWeek();
    } else {
      throw new Error('Invalid action requested.');
    }

    return createJsonResponse({ success: true, data: result });

  } catch (err) {
    console.error('API Error:', err);
    return createJsonResponse({ success: false, error: err.message || err.toString() });
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

/* ============================================================================
 * DATA RETRIEVAL HELPERS
 * ============================================================================ */

function getAllSeasons() {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(SHEETS.SEASONS);
  if (!sheet || sheet.getLastRow() <= 1) return [];

  return sheet.getDataRange().getValues().slice(1)
    .filter(r => r[0] !== undefined && r[0] !== '')
    .map(r => ({
      id: String(r[0]),
      name: String(r[1] || `Season ${r[0]}`)
    }));
}

function getSeasonName(seasonId) {
  if (!seasonId) return 'Unknown Season';
  const seasons = getAllSeasons();
  const found = seasons.find(x => String(x.id) === String(seasonId));
  if (found && found.name) return found.name;

  const cleanNum = String(seasonId).replace(/\D/g, '');
  return cleanNum ? `Season ${cleanNum}` : `Season ${seasonId}`;
}

function getSeasonPlayers(seasonId) {
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

  const spSheet = ss.getSheetByName(SHEETS.SEASON_PLAYERS);
  if (!spSheet || spSheet.getLastRow() <= 1) {
    return Object.values(masterPlayers).sort((a, b) => a.name.localeCompare(b.name));
  }

  const seasonPlayerIds = new Set();
  spSheet.getDataRange().getValues().slice(1).forEach(r => {
    if (String(r[0]) === String(seasonId) && String(r[2] || 'TRUE').toUpperCase() === 'TRUE') {
      seasonPlayerIds.add(String(r[1]));
    }
  });

  if (seasonPlayerIds.size === 0) {
    return Object.values(masterPlayers).sort((a, b) => a.name.localeCompare(b.name));
  }

  const roster = [];
  seasonPlayerIds.forEach(id => {
    if (masterPlayers[id]) roster.push(masterPlayers[id]);
  });

  return roster.sort((a, b) => a.name.localeCompare(b.name));
}

function getUnlinkedPlayers(seasonId) {
  const players = getSeasonPlayers(seasonId);
  return players.filter(p => !p.email);
}

function getSeasonLeaders(seasonId) {
  const ss = getSpreadsheet();
  const leaderSheet = ss.getSheetByName(SHEETS.LEADERS);
  const seasonLeadersSheet = ss.getSheetByName(SHEETS.SEASON_LEADERS);

  const masterLeaders = {};
  if (leaderSheet && leaderSheet.getLastRow() > 1) {
    leaderSheet.getDataRange().getValues().slice(1).forEach(r => {
      if (r[0]) {
        masterLeaders[String(r[0])] = {
          id: String(r[0]),
          name: `${r[1]} - ${r[2] || ''}`.trim()
        };
      }
    });
  }

  if (!seasonLeadersSheet || seasonLeadersSheet.getLastRow() <= 1) {
    return Object.values(masterLeaders).sort((a, b) => a.name.localeCompare(b.name));
  }

  const activeLeaderIds = new Set();
  seasonLeadersSheet.getDataRange().getValues().slice(1).forEach(r => {
    if (String(r[0]) === String(seasonId) && String(r[2] || 'TRUE').toUpperCase() === 'TRUE') {
      activeLeaderIds.add(String(r[1]));
    }
  });

  if (activeLeaderIds.size === 0) {
    return Object.values(masterLeaders).sort((a, b) => a.name.localeCompare(b.name));
  }

  const roster = [];
  activeLeaderIds.forEach(id => {
    if (masterLeaders[id]) roster.push(masterLeaders[id]);
  });

  return roster.sort((a, b) => a.name.localeCompare(b.name));
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

  // Check SubmissionLog first if available
  const slSheet = ss.getSheetByName(SHEETS.SUBMISSION_LOG);
  if (slSheet && slSheet.getLastRow() > 1) {
    const submitted = slSheet.getDataRange().getValues().slice(1).some(r =>
      String(r[1]) === String(seasonId) &&
      parseWeek(r[2]) === weekNum &&
      String(r[3]) === String(playerId)
    );
    if (submitted) return true;
  }

  // Fallback to LeaderVotes check
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
  const currentWeek = parseWeek(settings.CURRENT_WEEK);
  const votingOpen = isVotingOpen(settings);

  const linkedPlayer = findPlayerByGoogleEmail(userEmail);
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
    data.players = getSeasonPlayers(activeSeasonId);
    data.leaders = getSeasonLeaders(activeSeasonId);
    const submitted = hasSubmittedThisWeek(linkedPlayer.id, activeSeasonId, currentWeek);
    data.alreadySubmitted = submitted;
    data.alreadyVoted = submitted;
    data.hasVoted = submitted;
  } else {
    data.unlinkedPlayers = getUnlinkedPlayers(activeSeasonId);
  }

  return data;
}

function handleLinkGoogleAccount(playerId, email) {
  if (!playerId || !email) {
    throw new Error('Missing Player Selection or User Email.');
  }

  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(SHEETS.PLAYERS);
  const rows = sheet.getDataRange().getValues();

  const existing = findPlayerByGoogleEmail(email);
  if (existing) {
    if (existing.id === String(playerId)) return { player: existing, linkedPlayer: existing };
    throw new Error('Google account already linked to ' + existing.name);
  }

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(playerId)) {
      if (String(rows[i][3] || '').trim()) {
        throw new Error('This player is already linked to another account.');
      }
      sheet.getRange(i + 1, 4).setValue(email.toLowerCase().trim());

      const playerObj = {
        id: String(rows[i][0]),
        name: String(rows[i][1]),
        meleeName: String(rows[i][2] || ''),
        email: email.toLowerCase().trim(),
        active: String(rows[i][4] || 'TRUE').toUpperCase() === 'TRUE'
      };

      const settings = getSettings();
      const activeSeasonId = String(settings.ACTIVE_SEASON_ID || '');
      const currentWeek = parseWeek(settings.CURRENT_WEEK);

      return {
        success: true,
        player: playerObj,
        linkedPlayer: playerObj,
        players: getSeasonPlayers(activeSeasonId),
        leaders: getSeasonLeaders(activeSeasonId),
        alreadyVoted: hasSubmittedThisWeek(playerObj.id, activeSeasonId, currentWeek)
      };
    }
  }

  throw new Error('Player ID not found in master directory.');
}

function handleSubmitVote(payload, email) {
  const settings = getSettings();

  if (!isVotingOpen(settings)) {
    throw new Error('Voting is currently closed for this week.');
  }

  const player = findPlayerByGoogleEmail(email);
  if (!player || (player.active !== undefined && !player.active)) {
    throw new Error('Identity unlinked or inactive. Please link your player account.');
  }

  const seasonId = String(settings.ACTIVE_SEASON_ID || '');
  const week = parseWeek(settings.CURRENT_WEEK);

  if (hasSubmittedThisWeek(player.id, seasonId, week)) {
    throw new Error('You have already submitted votes for this week.');
  }

  // Normalize vote input formats across UI variants
  const voteData = payload.voteData || payload;
  const leader1Id = voteData.leader1Id || voteData.leaderId || voteData.leader;
  const opponentId = voteData.opponentId || voteData.favoriteOpponentId || voteData.opponent;

  if (opponentId && String(opponentId) === String(player.id)) {
    throw new Error('You cannot vote for yourself as favorite opponent.');
  }

  const ss = getSpreadsheet();
  const timestamp = new Date();

  let leaderVoteRow = null, opponentVoteRow = null, submissionLogRow = null;

  try {
    // 1. Record Leader Votes
    const lvSheet = ss.getSheetByName(SHEETS.LEADER_VOTES);
    if (lvSheet) {
      leaderVoteRow = lvSheet.getLastRow() + 1;
      if (leader1Id) lvSheet.appendRow([timestamp, seasonId, week, player.id, leader1Id, 1]);
    }

    // 2. Record Opponent Vote
    if (opponentId) {
      const ovSheet = ss.getSheetByName(SHEETS.OPPONENT_VOTES);
      if (ovSheet) {
        opponentVoteRow = ovSheet.getLastRow() + 1;
        ovSheet.appendRow([timestamp, seasonId, week, opponentId, player.id]);
      }
    }

    // 3. Record Submission Log
    const slSheet = ss.getSheetByName(SHEETS.SUBMISSION_LOG);
    if (slSheet) {
      submissionLogRow = slSheet.getLastRow() + 1;
      slSheet.appendRow([timestamp, seasonId, week, player.id]);
    }

    return { success: true, recorded: true, message: 'Votes successfully recorded!' };

  } catch (err) {
    // Rollback entries on failure
    if (submissionLogRow) try { ss.getSheetByName(SHEETS.SUBMISSION_LOG).deleteRow(submissionLogRow); } catch (e) {}
    if (opponentVoteRow) try { ss.getSheetByName(SHEETS.OPPONENT_VOTES).deleteRow(opponentVoteRow); } catch (e) {}
    if (leaderVoteRow) try { ss.getSheetByName(SHEETS.LEADER_VOTES).deleteRow(leaderVoteRow); } catch (e) {}
    throw err;
  }
}

function handleGetLeaderboardData(requestedSeasonId) {
  const settings = getSettings();
  const activeSeasonId = String(settings.ACTIVE_SEASON_ID || '');
  const targetSeasonId = requestedSeasonId ? String(requestedSeasonId) : activeSeasonId;

  const isCurrentActiveSeason = (String(targetSeasonId) === activeSeasonId);
  const ss = getSpreadsheet();

  const playerRows = ss.getSheetByName(SHEETS.PLAYERS).getDataRange().getValues().slice(1);
  const playerMap = {};
  playerRows.forEach(r => { if (r[0]) playerMap[String(r[0])] = String(r[1]); });

  const leaderRows = ss.getSheetByName(SHEETS.LEADERS).getDataRange().getValues().slice(1);
  const leaderMap = {};
  leaderRows.forEach(r => { if (r[0]) leaderMap[String(r[0])] = `${r[1]} - ${r[2] || ''}`.trim(); });

  const leaderVotes = ss.getSheetByName(SHEETS.LEADER_VOTES).getDataRange().getValues().slice(1);
  
  // Calculate Standard Counts
  const leaderCounts = {};
  const stats = {};

  leaderVotes.forEach(r => {
    if (String(r[1]) !== targetSeasonId) return;
    const pId = String(r[3]);
    const lId = String(r[4]);

    leaderCounts[lId] = (leaderCounts[lId] || 0) + 1;

    if (!stats[pId]) {
      stats[pId] = { playerName: playerMap[pId] || `Unknown (${pId})`, leadersPlayed: new Set(), leaderCounts: {} };
    }
    stats[pId].leadersPlayed.add(lId);
    stats[pId].leaderCounts[lId] = (stats[pId].leaderCounts[lId] || 0) + 1;
  });

  const leaderLeaderboard = Object.keys(leaderCounts).map(lId => ({
    id: lId,
    name: leaderMap[lId] || lId,
    votes: leaderCounts[lId]
  })).sort((a, b) => b.votes - a.votes);

  const diversity = [];
  const loyalty = [];

  Object.keys(stats).forEach(id => {
    const s = stats[id];
    let topLeaderId = '', maxCount = 0;
    const sorted = Object.keys(s.leaderCounts).sort((a, b) => s.leaderCounts[b] - s.leaderCounts[a]);
    if (sorted.length > 0) {
      topLeaderId = sorted[0];
      maxCount = s.leaderCounts[topLeaderId];
    }
    if (s.leadersPlayed.size > 0) diversity.push({ playerName: s.playerName, differentLeaders: s.leadersPlayed.size });
    if (maxCount > 0) loyalty.push({ playerName: s.playerName, leader: leaderMap[topLeaderId] || '', nights: maxCount });
  });

  diversity.sort((a, b) => b.differentLeaders - a.differentLeaders || a.playerName.localeCompare(b.playerName));
  loyalty.sort((a, b) => b.nights - a.nights || a.playerName.localeCompare(b.playerName));

  // Opponent Counts
  const opponentVotes = ss.getSheetByName(SHEETS.OPPONENT_VOTES) ? 
    ss.getSheetByName(SHEETS.OPPONENT_VOTES).getDataRange().getValues().slice(1) : [];
  
  const opponentCounts = {};
  opponentVotes.forEach(r => {
    if (String(r[1]) === targetSeasonId) {
      const pId = String(r[3]);
      if (pId) opponentCounts[pId] = (opponentCounts[pId] || 0) + 1;
    }
  });

  const opponentLeaderboard = Object.keys(opponentCounts).map(pId => ({
    id: pId,
    name: playerMap[pId] || pId,
    votes: opponentCounts[pId]
  })).sort((a, b) => b.votes - a.votes);

  const rankedMostPlayed = assignStandardRanks(leaderLeaderboard, 'votes');
  const rankedDiversity = assignStandardRanks(diversity, 'differentLeaders');
  const rankedLoyalty = assignStandardRanks(loyalty, 'nights');
  const rankedOpponents = assignStandardRanks(opponentLeaderboard, 'votes');

  return {
    success: true,
    seasonId: targetSeasonId,
    seasonName: getSeasonName(targetSeasonId),
    isActiveSeason: isCurrentActiveSeason,
    leaderLeaderboard: rankedMostPlayed,
    opponentLeaderboard: rankedOpponents,
    diversity: rankedDiversity,
    loyalty: rankedLoyalty
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

    compileWeekSummary(seasonId, currentWeekNum);

    if (currentWeekNum >= 11) {
      updateSetting(settingsSheet, 'VOTING_OPEN', 'FALSE');
      updateSetting(settingsSheet, 'CURRENT_WEEK', 'Season Ended');
      calculateSeasonAwards(seasonId);
      return { success: true, message: 'Season 11 completed, voting closed, awards calculated.' };
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

function compileWeekSummary(seasonId, weekNum) {
  const ss = getSpreadsheet();
  const summarySheet = ss.getSheetByName(SHEETS.SEASON_SUMMARY);
  if (!summarySheet) return;

  const lvRows = ss.getSheetByName(SHEETS.LEADER_VOTES).getDataRange().getValues().slice(1);
  const ovRows = ss.getSheetByName(SHEETS.OPPONENT_VOTES) ? 
    ss.getSheetByName(SHEETS.OPPONENT_VOTES).getDataRange().getValues().slice(1) : [];

  const leaderCounts = {};
  lvRows.forEach(r => {
    if (String(r[1]) === String(seasonId) && parseWeek(r[2]) === weekNum) {
      const lId = String(r[4]);
      leaderCounts[lId] = (leaderCounts[lId] || 0) + 1;
    }
  });

  const opponentCounts = {};
  ovRows.forEach(r => {
    if (String(r[1]) === String(seasonId) && parseWeek(r[2]) === weekNum) {
      const pId = String(r[3]);
      opponentCounts[pId] = (opponentCounts[pId] || 0) + 1;
    }
  });

  const topLeaderId = Object.keys(leaderCounts).sort((a,b) => leaderCounts[b] - leaderCounts[a])[0] || 'None';
  const topOpponentId = Object.keys(opponentCounts).sort((a,b) => opponentCounts[b] - opponentCounts[a])[0] || 'None';

  summarySheet.appendRow([
    new Date(),
    seasonId,
    `Week ${weekNum}`,
    topLeaderId,
    leaderCounts[topLeaderId] || 0,
    topOpponentId,
    opponentCounts[topOpponentId] || 0
  ]);
}

function calculateSeasonAwards(seasonId) {
  const ss = getSpreadsheet();
  const awardsSheet = ss.getSheetByName(SHEETS.AWARDS);
  if (!awardsSheet) return;

  const ovRows = ss.getSheetByName(SHEETS.OPPONENT_VOTES) ? 
    ss.getSheetByName(SHEETS.OPPONENT_VOTES).getDataRange().getValues().slice(1) : [];
  const players = ss.getSheetByName(SHEETS.PLAYERS).getDataRange().getValues().slice(1);

  const playerMap = {};
  players.forEach(p => { if (p[0]) playerMap[String(p[0])] = String(p[1]); });

  const opponentVoteCounts = {};
  ovRows.forEach(r => {
    if (String(r[1]) === String(seasonId)) {
      const oppId = String(r[3]);
      if (oppId) opponentVoteCounts[oppId] = (opponentVoteCounts[oppId] || 0) + 1;
    }
  });

  const sortedOpponents = Object.keys(opponentVoteCounts).sort((a,b) => opponentVoteCounts[b] - opponentVoteCounts[a]);
  const favoriteOpponentId = sortedOpponents[0] || '';
  const favoriteOpponentName = playerMap[favoriteOpponentId] || favoriteOpponentId;
  const favVotes = opponentVoteCounts[favoriteOpponentId] || 0;

  if (favoriteOpponentId) {
    awardsSheet.appendRow([
      seasonId,
      'Favorite Opponent',
      favoriteOpponentId,
      favoriteOpponentName,
      `${favVotes} votes`,
      new Date()
    ]);
  }
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

  const url = process.env.SCRAPE_URL || 'https://stockholm.sw-unlimited.com/';

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
  const activeScrapedPlayerIds = new Set();

  scrapedPlayers.forEach((playerData, key) => {
    if (existingMeleeMap.has(key)) {
      const record = existingMeleeMap.get(key);
      const currentDisplayName = String(rows[record.rowIndex - 1][1] || '').trim();
      if (playerData.name && currentDisplayName !== playerData.name) {
        playerSheet.getRange(record.rowIndex, 2).setValue(playerData.name);
      }
      activeScrapedPlayerIds.add(record.playerId);
    } else {
      const newId = 'P' + String(nextIdNumber).padStart(3, '0');
      playerSheet.appendRow([newId, playerData.name, playerData.meleeName, '', 'TRUE']);
      activeScrapedPlayerIds.add(newId);
      nextIdNumber++;
    }
  });

  const seasonPlayerSheet = ss.getSheetByName(SHEETS.SEASON_PLAYERS);
  if (seasonPlayerSheet) {
    const spRows = seasonPlayerSheet.getDataRange().getValues();
    const existingSeasonLinks = new Set();
    for (let i = 1; i < spRows.length; i++) {
      if (String(spRows[i][0]) === activeSeasonId) existingSeasonLinks.add(String(spRows[i][1]));
    }
    activeScrapedPlayerIds.forEach(pId => {
      if (!existingSeasonLinks.has(pId)) {
        seasonPlayerSheet.appendRow([activeSeasonId, pId, 'TRUE']);
      }
    });
  }
}