const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadBackend } = require('./mockSheets.js');

// Pure functions need the backend loaded (for globals), but no data reads.
loadBackend();

test('parseWeek extracts the leading integer', () => {
  assert.equal(parseWeek('Week 3'), 3);
  assert.equal(parseWeek('week 12'), 12);
  assert.equal(parseWeek(7), 7);
  assert.equal(parseWeek('8'), 8);
});

test('parseWeek falls back to 1 for empty / non-numeric input', () => {
  assert.equal(parseWeek(''), 1);
  assert.equal(parseWeek(null), 1);
  assert.equal(parseWeek(undefined), 1);
});

test('isVotingOpen treats a real boolean correctly', () => {
  assert.equal(isVotingOpen({ VOTING_OPEN: true }), true);
  assert.equal(isVotingOpen({ VOTING_OPEN: false }), false);
});

test('isVotingOpen handles common string representations', () => {
  assert.equal(isVotingOpen({ VOTING_OPEN: 'TRUE' }), true);
  assert.equal(isVotingOpen({ VOTING_OPEN: 'true ' }), true);
  assert.equal(isVotingOpen({ VOTING_OPEN: 'YES' }), true);
  assert.equal(isVotingOpen({ VOTING_OPEN: '1' }), true);
  assert.equal(isVotingOpen({ VOTING_OPEN: 'FALSE' }), false);
  assert.equal(isVotingOpen({ VOTING_OPEN: 'false' }), false);
  assert.equal(isVotingOpen({ VOTING_OPEN: 'no' }), false);
});

test('isVotingOpen defaults to closed when the setting is absent', () => {
  assert.equal(isVotingOpen({}), false);
  assert.equal(isVotingOpen(null), false);
  assert.equal(isVotingOpen(undefined), false);
  assert.equal(isVotingOpen({ VOTING_OPEN: null }), false);
});

test('assignStandardRanks assigns 1,2,3... with ties sharing and skipping ranks', () => {
  const ranked = assignStandardRanks([
    { name: 'A', score: 5 },
    { name: 'B', score: 5 },
    { name: 'C', score: 4 },
    { name: 'D', score: 3 }
  ], 'score');
  assert.deepEqual(ranked.map((r) => r.displayRank), [1, 1, 3, 4]);
});

test('assignStandardRanks returns copies with the new displayRank field', () => {
  const input = [{ name: 'A', score: 2 }];
  const ranked = assignStandardRanks(input, 'score');
  assert.notEqual(ranked, input);
  assert.notEqual(ranked[0], input[0]);
  assert.equal(ranked[0].name, 'A');
  assert.equal(ranked[0].score, 2);
  assert.equal(ranked[0].displayRank, 1);
});

test('assignStandardRanks handles empty input', () => {
  assert.deepEqual(assignStandardRanks([], 'score'), []);
});

test('userError throws an Error carrying the userMessage flag', () => {
  let caught;
  try {
    userError('A friendly message');
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof Error, 'expected an Error to be thrown');
  assert.equal(caught.userMessage, 'A friendly message');
});
