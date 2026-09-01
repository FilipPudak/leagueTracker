/****************************************************
 * CLIENT INTERFACE PROXY (SCRIPT 2)
 * Executes as: USER ACCESSING THE WEB APP
 * Access: ANYONE WITH GOOGLE ACCOUNT
 ****************************************************/

// Config loaded from Apps Script Script Properties at runtime (not committed).
function getConfig(key, fallback) {
  const val = PropertiesService.getScriptProperties().getProperty(key);
  return val || fallback;
}

// Published Script 1 Executable URL
const API_URL = getConfig('API_URL');

// Shared secret required by the backend. Stays server-side (never sent to the browser).
const API_SECRET = getConfig('API_SECRET', '');

function doGet() {
  return HtmlService
    .createTemplateFromFile('Index')
    .evaluate()
    .setTitle('SWU League Voting')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Executes a server-to-server POST call to Script 1
 */
function callApi(action, payloadData = {}) {
  const email = Session.getActiveUser().getEmail();
  if (!email) {
    throw new Error('Could not identify your Google email. Make sure you are signed into Chrome/Google.');
  }

  const payload = Object.assign({ action: action, userEmail: email, apiSecret: API_SECRET }, payloadData);

  const options = {
    method: 'post',
    contentType: 'text/plain;charset=utf-8',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(API_URL, options);
  const text = response.getContentText();
  let result;
  try {
    result = JSON.parse(text);
  } catch (err) {
    console.error('Backend returned a non-JSON response (HTTP ' + response.getResponseCode() +
      '). Check that API_URL points at a valid deployed /exec URL and that the backend Script Properties are set.');
    throw new Error('The server returned an unexpected response. Please try again.');
  }

  if (!result.success) {
    throw new Error(result.error || 'Server error.');
  }

  return result.data;
}

/* Wrapper methods for google.script.run */
function getAppData() { return callApi('getAppData'); }
function linkGoogleAccount(playerId) { return callApi('linkGoogleAccount', { playerId: playerId }); }
function submitVote(leader1Id, leader2Id, opponentId) {
  if (typeof leader1Id === 'object') {
    return callApi('submitVote', { voteData: leader1Id });
  }
  return callApi('submitVote', { leader1Id: leader1Id, leader2Id: leader2Id, opponentId: opponentId });
}
function getLeaderboardData(seasonId) { return callApi('getLeaderboardData', { seasonId: seasonId }); }
function getMySeasonStats(seasonId) { return callApi('getMySeasonStats', { seasonId: seasonId }); }