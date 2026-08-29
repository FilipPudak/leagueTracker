/****************************************************
 * CLIENT INTERFACE PROXY (SCRIPT 2)
 * Executes as: USER ACCESSING THE WEB APP
 * Access: ANYONE WITH GOOGLE ACCOUNT
 ****************************************************/

// Published Script 1 Executable URL (injected from .env / process.env)
const API_URL = process.env.API_URL;

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

  const payload = Object.assign({ action: action, userEmail: email }, payloadData);

  const options = {
    method: 'post',
    contentType: 'text/plain;charset=utf-8',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(API_URL, options);
  const result = JSON.parse(response.getContentText());

  if (!result.success) {
    throw new Error(result.error || 'Server error.');
  }

  return result.data;
}

/* Wrapper methods for google.script.run */
function getInitialData() { return callApi('getInitialData'); }
function getAppData() { return callApi('getAppData'); }
function linkAccount(playerId) { return callApi('linkAccount', { playerId: playerId }); }
function linkGoogleAccount(playerId) { return callApi('linkGoogleAccount', { playerId: playerId }); }
function submitVote(leader1Id, leader2Id, opponentId) {
  if (typeof leader1Id === 'object') {
    return callApi('submitVote', { voteData: leader1Id });
  }
  return callApi('submitVote', { leader1Id: leader1Id, leader2Id: leader2Id, opponentId: opponentId });
}
function getLeaderboardData(seasonId) { return callApi('getLeaderboardData', { seasonId: seasonId }); }