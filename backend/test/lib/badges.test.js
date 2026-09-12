import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeBadges } from '../../src/lib/badges.js';
import { createMockDb } from '../helpers/mock-db.js';

function standingsRow(playerId, wins, losses, draws, rank, seasonId = 6, round = 1) {
  return { season_id: seasonId, round, player_id: playerId, wins, losses, draws, rank };
}

function matchRow(p1, p2, winner, result, extra = {}) {
  return { season_id: 6, round: 1, player1_id: p1, player2_id: p2, winner_id: winner, result, is_bye: 0, ...extra };
}

describe('lib/badges computeBadges', () => {

  describe('flat badges', () => {

    describe('First Night', () => {
      it('earned when player has any attendance', async () => {
        const db = createMockDb({
          attendance: [{ season_id: 6, week: 1, player_id: 'P001' }],
          melee_tournaments: [{ season_id: 6, round: 1, phase: 'regular' }],
          season_standings: [],
          match_results: [],
          votes: [],
          awards: [],
        });
        const badges = await computeBadges(db, 'P001');
        const b = badges.find(b => b.id === 'firstNight');
        assert.equal(b.earned, true);
      });

      it('not earned when no attendance', async () => {
        const db = createMockDb({
          attendance: [],
          season_standings: [],
          match_results: [],
          votes: [],
          awards: [],
        });
        const badges = await computeBadges(db, 'P001');
        const b = badges.find(b => b.id === 'firstNight');
        assert.equal(b.earned, false);
      });
    });

    describe('Night Champion', () => {
      it('earned when player has rank 1 in any night', async () => {
        const db = createMockDb({
          attendance: [],
          season_standings: [standingsRow('P001', 3, 0, 0, 1)],
          match_results: [],
          votes: [],
          awards: [],
        });
        const badges = await computeBadges(db, 'P001');
        const b = badges.find(b => b.id === 'nightChampion');
        assert.equal(b.earned, true);
      });

      it('not earned when never rank 1', async () => {
        const db = createMockDb({
          attendance: [],
          season_standings: [standingsRow('P001', 2, 1, 0, 2)],
          match_results: [],
          votes: [],
          awards: [],
        });
        const badges = await computeBadges(db, 'P001');
        const b = badges.find(b => b.id === 'nightChampion');
        assert.equal(b.earned, false);
      });
    });

    describe('Giant Slayer', () => {
      it('earned when player beat a previous Ruler', async () => {
        const db = createMockDb({
          attendance: [],
          season_standings: [],
          match_results: [
            matchRow('P001', 'P002', 'P001', 'Alice won 2-0-0'),
          ],
          votes: [],
          awards: [
            { season_id: 5, award_name: 'Galactic Ruler', player_id: 'P002', score: 50 },
          ],
        });
        const badges = await computeBadges(db, 'P001');
        const b = badges.find(b => b.id === 'giantSlayer');
        assert.equal(b.earned, true);
      });

      it('earned when player beat a previous Champion', async () => {
        const db = createMockDb({
          attendance: [],
          season_standings: [],
          match_results: [
            matchRow('P001', 'P003', 'P001', 'Alice won 2-1-0'),
          ],
          votes: [],
          awards: [
            { season_id: 5, award_name: 'Galactic Champion', player_id: 'P003', score: 1 },
          ],
        });
        const badges = await computeBadges(db, 'P001');
        const b = badges.find(b => b.id === 'giantSlayer');
        assert.equal(b.earned, true);
      });

      it('not earned when beating non-Ruler/Champion', async () => {
        const db = createMockDb({
          attendance: [],
          season_standings: [],
          match_results: [
            matchRow('P001', 'P002', 'P001', 'Alice won 2-0-0'),
          ],
          votes: [],
          awards: [
            { season_id: 5, award_name: 'Galactic Schemer', player_id: 'P002', score: 5 },
          ],
        });
        const badges = await computeBadges(db, 'P001');
        const b = badges.find(b => b.id === 'giantSlayer');
        assert.equal(b.earned, false);
      });

      it('not earned when player lost to Ruler', async () => {
        const db = createMockDb({
          attendance: [],
          season_standings: [],
          match_results: [
            matchRow('P001', 'P002', 'P002', 'Bob won 2-0-0'),
          ],
          votes: [],
          awards: [
            { season_id: 5, award_name: 'Galactic Ruler', player_id: 'P002', score: 50 },
          ],
        });
        const badges = await computeBadges(db, 'P001');
        const b = badges.find(b => b.id === 'giantSlayer');
        assert.equal(b.earned, false);
      });
    });

    describe('Crowd Favorite', () => {
      it('earned when player received 3+ favorite-opponent votes in one season', async () => {
        const db = createMockDb({
          attendance: [],
          season_standings: [],
          match_results: [],
          votes: [
            { id: 1, season_id: 6, week: 1, player_id: 'P002', leader_id: '1', opponent_id: 'P001' },
            { id: 2, season_id: 6, week: 2, player_id: 'P003', leader_id: '2', opponent_id: 'P001' },
            { id: 3, season_id: 6, week: 3, player_id: 'P004', leader_id: '1', opponent_id: 'P001' },
          ],
          awards: [],
        });
        const badges = await computeBadges(db, 'P001');
        const b = badges.find(b => b.id === 'crowdFavorite');
        assert.equal(b.earned, true);
      });

      it('not earned with only 2 votes', async () => {
        const db = createMockDb({
          attendance: [],
          season_standings: [],
          match_results: [],
          votes: [
            { id: 1, season_id: 6, week: 1, player_id: 'P002', leader_id: '1', opponent_id: 'P001' },
            { id: 2, season_id: 6, week: 2, player_id: 'P003', leader_id: '2', opponent_id: 'P001' },
          ],
          awards: [],
        });
        const badges = await computeBadges(db, 'P001');
        const b = badges.find(b => b.id === 'crowdFavorite');
        assert.equal(b.earned, false);
      });

      it('same voter across 3 weeks counts as 1 distinct voter', async () => {
        const db = createMockDb({
          attendance: [],
          season_standings: [],
          match_results: [],
          votes: [
            { id: 1, season_id: 6, week: 1, player_id: 'P002', leader_id: '1', opponent_id: 'P001' },
            { id: 2, season_id: 6, week: 2, player_id: 'P002', leader_id: '2', opponent_id: 'P001' },
            { id: 3, season_id: 6, week: 3, player_id: 'P002', leader_id: '3', opponent_id: 'P001' },
          ],
          awards: [],
        });
        const badges = await computeBadges(db, 'P001');
        const b = badges.find(b => b.id === 'crowdFavorite');
        assert.equal(b.earned, false);
      });

      it('not earned when votes are from active season', async () => {
        const db = createMockDb({
          attendance: [],
          season_standings: [],
          match_results: [],
          votes: [
            { id: 1, season_id: 6, week: 1, player_id: 'P002', leader_id: '1', opponent_id: 'P001' },
            { id: 2, season_id: 6, week: 2, player_id: 'P003', leader_id: '2', opponent_id: 'P001' },
            { id: 3, season_id: 6, week: 3, player_id: 'P004', leader_id: '1', opponent_id: 'P001' },
          ],
          awards: [],
        });
        const badges = await computeBadges(db, 'P001', 6, true);
        const b = badges.find(b => b.id === 'crowdFavorite');
        assert.equal(b.earned, false);
      });

      it('earned when votes are from a completed season', async () => {
        const db = createMockDb({
          attendance: [],
          season_standings: [],
          match_results: [],
          votes: [
            { id: 1, season_id: 5, week: 1, player_id: 'P002', leader_id: '1', opponent_id: 'P001' },
            { id: 2, season_id: 5, week: 2, player_id: 'P003', leader_id: '2', opponent_id: 'P001' },
            { id: 3, season_id: 5, week: 3, player_id: 'P004', leader_id: '1', opponent_id: 'P001' },
          ],
          awards: [],
        });
        const badges = await computeBadges(db, 'P001', 6, true);
        const b = badges.find(b => b.id === 'crowdFavorite');
        assert.equal(b.earned, true);
      });
    });

    describe('Loyalist', () => {
      it('earned when player attended 3+ consecutive seasons', async () => {
        const db = createMockDb({
          attendance: [
            { season_id: 4, week: 1, player_id: 'P001' },
            { season_id: 5, week: 1, player_id: 'P001' },
            { season_id: 6, week: 1, player_id: 'P001' },
          ],
          melee_tournaments: [
            { season_id: 4, round: 1, phase: 'regular' },
            { season_id: 5, round: 1, phase: 'regular' },
            { season_id: 6, round: 1, phase: 'regular' },
          ],
          season_standings: [],
          match_results: [],
          votes: [],
          awards: [],
        });
        const badges = await computeBadges(db, 'P001');
        const b = badges.find(b => b.id === 'loyalist');
        assert.equal(b.earned, true);
      });

      it('not earned with only 2 seasons', async () => {
        const db = createMockDb({
          attendance: [
            { season_id: 5, week: 1, player_id: 'P001' },
            { season_id: 6, week: 1, player_id: 'P001' },
          ],
          melee_tournaments: [
            { season_id: 5, round: 1, phase: 'regular' },
            { season_id: 6, round: 1, phase: 'regular' },
          ],
          season_standings: [],
          match_results: [],
          votes: [],
          awards: [],
        });
        const badges = await computeBadges(db, 'P001');
        const b = badges.find(b => b.id === 'loyalist');
        assert.equal(b.earned, false);
      });

      it('not earned with non-consecutive seasons', async () => {
        const db = createMockDb({
          attendance: [
            { season_id: 3, week: 1, player_id: 'P001' },
            { season_id: 5, week: 1, player_id: 'P001' },
            { season_id: 6, week: 1, player_id: 'P001' },
          ],
          melee_tournaments: [
            { season_id: 3, round: 1, phase: 'regular' },
            { season_id: 5, round: 1, phase: 'regular' },
            { season_id: 6, round: 1, phase: 'regular' },
          ],
          season_standings: [],
          match_results: [],
          votes: [],
          awards: [],
        });
        const badges = await computeBadges(db, 'P001');
        const b = badges.find(b => b.id === 'loyalist');
        assert.equal(b.earned, false);
      });
    });
  });

  describe('tiered badges', () => {

    describe('Night Wins', () => {
      it('returns correct tier based on total wins', async () => {
        const db = createMockDb({
          attendance: [],
          season_standings: [
            standingsRow('P001', 3, 0, 0, 1, 6, 1),
            standingsRow('P001', 2, 1, 0, 2, 6, 2),
            standingsRow('P001', 1, 2, 0, 3, 6, 3),
          ],
          match_results: [],
          votes: [],
          awards: [],
        });
        const badges = await computeBadges(db, 'P001');
        const b = badges.find(b => b.id === 'nightWins');
        assert.equal(b.value, 6);
        assert.equal(b.tier, 'bronze');
      });

      it('silver tier at 15 wins', async () => {
        const standings = [];
        for (let i = 1; i <= 6; i++) {
          standings.push(standingsRow('P001', 3, 0, 0, 1, 6, i));
        }
        const db = createMockDb({ attendance: [], season_standings: standings, match_results: [], votes: [], awards: [] });
        const badges = await computeBadges(db, 'P001');
        const b = badges.find(b => b.id === 'nightWins');
        assert.equal(b.value, 18);
        assert.equal(b.tier, 'silver');
      });

      it('gold tier at 30 wins', async () => {
        const standings = [];
        for (let i = 1; i <= 10; i++) {
          standings.push(standingsRow('P001', 3, 0, 0, 1, 6, i));
        }
        const db = createMockDb({ attendance: [], season_standings: standings, match_results: [], votes: [], awards: [] });
        const badges = await computeBadges(db, 'P001');
        const b = badges.find(b => b.id === 'nightWins');
        assert.equal(b.value, 30);
        assert.equal(b.tier, 'gold');
      });
    });

    describe('Undefeated Nights', () => {
      it('bronze at 1 undefeated night', async () => {
        const db = createMockDb({
          attendance: [],
          season_standings: [standingsRow('P001', 3, 0, 0, 1)],
          match_results: [],
          votes: [],
          awards: [],
        });
        const badges = await computeBadges(db, 'P001');
        const b = badges.find(b => b.id === 'cleanSheet');
        assert.equal(b.value, 1);
        assert.equal(b.tier, 'bronze');
      });

      it('silver at 3', async () => {
        const db = createMockDb({
          attendance: [],
          season_standings: [
            standingsRow('P001', 3, 0, 0, 1, 6, 1),
            standingsRow('P001', 3, 0, 0, 1, 6, 2),
            standingsRow('P001', 3, 0, 0, 1, 6, 3),
          ],
          match_results: [],
          votes: [],
          awards: [],
        });
        const badges = await computeBadges(db, 'P001');
        const b = badges.find(b => b.id === 'cleanSheet');
        assert.equal(b.value, 3);
        assert.equal(b.tier, 'silver');
      });

      it('night with losses does not count', async () => {
        const db = createMockDb({
          attendance: [],
          season_standings: [
            standingsRow('P001', 3, 0, 0, 1, 6, 1),
            standingsRow('P001', 2, 1, 0, 2, 6, 2),
          ],
          match_results: [],
          votes: [],
          awards: [],
        });
        const badges = await computeBadges(db, 'P001');
        const b = badges.find(b => b.id === 'cleanSheet');
        assert.equal(b.value, 1);
      });
    });

    describe('Attendance', () => {
      it('bronze at 10 nights', async () => {
        const attendance = [];
        const melee_tournaments = [];
        for (let w = 1; w <= 10; w++) {
          attendance.push({ season_id: 6, week: w, player_id: 'P001' });
          melee_tournaments.push({ season_id: 6, round: w, phase: 'regular' });
        }
        const db = createMockDb({ attendance, melee_tournaments, season_standings: [], match_results: [], votes: [], awards: [] });
        const badges = await computeBadges(db, 'P001');
        const b = badges.find(b => b.id === 'attendance');
        assert.equal(b.value, 10);
        assert.equal(b.tier, 'bronze');
      });

      it('counts across seasons', async () => {
        const attendance = [];
        const melee_tournaments = [];
        for (let w = 1; w <= 5; w++) {
          attendance.push({ season_id: 5, week: w, player_id: 'P001' });
          attendance.push({ season_id: 6, week: w, player_id: 'P001' });
          melee_tournaments.push({ season_id: 5, round: w, phase: 'regular' });
          melee_tournaments.push({ season_id: 6, round: w, phase: 'regular' });
        }
        const db = createMockDb({ attendance, melee_tournaments, season_standings: [], match_results: [], votes: [], awards: [] });
        const badges = await computeBadges(db, 'P001');
        const b = badges.find(b => b.id === 'attendance');
        assert.equal(b.value, 10);
        assert.equal(b.tier, 'bronze');
      });
    });

    describe('Leader Variety', () => {
      it('bronze at 3 distinct leaders', async () => {
        const db = createMockDb({
          attendance: [],
          season_standings: [],
          match_results: [],
          votes: [
            { id: 1, season_id: 6, week: 1, player_id: 'P001', leader_id: '1', opponent_id: 'P002' },
            { id: 2, season_id: 6, week: 2, player_id: 'P001', leader_id: '2', opponent_id: 'P002' },
            { id: 3, season_id: 6, week: 3, player_id: 'P001', leader_id: '3', opponent_id: 'P002' },
          ],
          awards: [],
        });
        const badges = await computeBadges(db, 'P001');
        const b = badges.find(b => b.id === 'leaderVariety');
        assert.equal(b.value, 3);
        assert.equal(b.tier, 'bronze');
      });
    });

    describe('Sweep Master', () => {
      it('bronze at 5 sweeps (2-0 wins)', async () => {
        const matches = [];
        for (let i = 1; i <= 5; i++) {
          matches.push(matchRow('P001', 'P002', 'P001', 'Alice won 2-0-0', { round: i }));
        }
        const db = createMockDb({ attendance: [], season_standings: [], match_results: matches, votes: [], awards: [] });
        const badges = await computeBadges(db, 'P001');
        const b = badges.find(b => b.id === 'sweepMaster');
        assert.equal(b.value, 5);
        assert.equal(b.tier, 'bronze');
      });

      it('2-1 wins do not count as sweeps', async () => {
        const matches = [];
        for (let i = 1; i <= 5; i++) {
          matches.push(matchRow('P001', 'P002', 'P001', 'Alice won 2-1-0', { round: i }));
        }
        const db = createMockDb({ attendance: [], season_standings: [], match_results: matches, votes: [], awards: [] });
        const badges = await computeBadges(db, 'P001');
        const b = badges.find(b => b.id === 'sweepMaster');
        assert.equal(b.value, 0);
        assert.equal(b.tier, null);
      });

      it('byes do not count as sweeps', async () => {
        const matches = [
          { season_id: 6, round: 1, player1_id: 'P001', player2_id: null, winner_id: 'P001', result: null, is_bye: 1 },
        ];
        const db = createMockDb({ attendance: [], season_standings: [], match_results: matches, votes: [], awards: [] });
        const badges = await computeBadges(db, 'P001');
        const b = badges.find(b => b.id === 'sweepMaster');
        assert.equal(b.value, 0);
      });
    });

    describe('Deck Master', () => {
      it('earned when won 3+ matches each with 6 different leaders in a season', async () => {
        const matches = [];
        const votes = [];
        const leaders = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'];
        for (let i = 0; i < 6; i++) {
          for (let w = 0; w < 3; w++) {
            matches.push(matchRow('P001', 'P002', 'P001', 'Alice won 2-0-0', { season_id: 6, round: i * 3 + w + 1 }));
            votes.push({ season_id: 6, week: i * 3 + w + 1, player_id: 'P001', leader_id: leaders[i] });
          }
        }
        const db = createMockDb({ attendance: [], season_standings: [], match_results: matches, votes, awards: [] });
        const badges = await computeBadges(db, 'P001');
        const b = badges.find(b => b.id === 'deckMaster');
        assert.equal(b.earned, true);
      });

      it('not earned when leaders have only 1 win each', async () => {
        const matches = [];
        const votes = [];
        const leaders = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'];
        for (let i = 0; i < 6; i++) {
          matches.push(matchRow('P001', 'P002', 'P001', 'Alice won 2-0-0', { season_id: 6, round: i + 1 }));
          votes.push({ season_id: 6, week: i + 1, player_id: 'P001', leader_id: leaders[i] });
        }
        const db = createMockDb({ attendance: [], season_standings: [], match_results: matches, votes, awards: [] });
        const badges = await computeBadges(db, 'P001');
        const b = badges.find(b => b.id === 'deckMaster');
        assert.equal(b.earned, false);
      });

      it('not earned when only 5 leaders have 3+ wins', async () => {
        const matches = [];
        const votes = [];
        const leaders = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'];
        for (let i = 0; i < 6; i++) {
          const winCount = i < 5 ? 3 : 1;
          for (let w = 0; w < winCount; w++) {
            matches.push(matchRow('P001', 'P002', 'P001', 'Alice won 2-0-0', { season_id: 6, round: i * 3 + w + 1 }));
            votes.push({ season_id: 6, week: i * 3 + w + 1, player_id: 'P001', leader_id: leaders[i] });
          }
        }
        const db = createMockDb({ attendance: [], season_standings: [], match_results: matches, votes, awards: [] });
        const badges = await computeBadges(db, 'P001');
        const b = badges.find(b => b.id === 'deckMaster');
        assert.equal(b.earned, false);
      });

      it('wins spread across seasons do not combine', async () => {
        const matches = [];
        const votes = [];
        for (let i = 0; i < 3; i++) {
          for (let w = 0; w < 3; w++) {
            matches.push(matchRow('P001', 'P002', 'P001', 'Alice won 2-0-0', { season_id: 5, round: i * 3 + w + 1 }));
            votes.push({ season_id: 5, week: i * 3 + w + 1, player_id: 'P001', leader_id: 'L' + (i + 1) });
          }
        }
        for (let i = 0; i < 3; i++) {
          for (let w = 0; w < 3; w++) {
            matches.push(matchRow('P001', 'P002', 'P001', 'Alice won 2-0-0', { season_id: 6, round: i * 3 + w + 1 }));
            votes.push({ season_id: 6, week: i * 3 + w + 1, player_id: 'P001', leader_id: 'L' + (i + 4) });
          }
        }
        const db = createMockDb({ attendance: [], season_standings: [], match_results: matches, votes, awards: [] });
        const badges = await computeBadges(db, 'P001');
        const b = badges.find(b => b.id === 'deckMaster');
        assert.equal(b.earned, false);
      });

      it('losses do not count toward deck master', async () => {
        const matches = [];
        const votes = [];
        const leaders = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'];
        for (let i = 0; i < 6; i++) {
          for (let w = 0; w < 3; w++) {
            matches.push(matchRow('P001', 'P002', 'P002', 'Bob won 2-0-0', { season_id: 6, round: i * 3 + w + 1 }));
            votes.push({ season_id: 6, week: i * 3 + w + 1, player_id: 'P001', leader_id: leaders[i] });
          }
        }
        const db = createMockDb({ attendance: [], season_standings: [], match_results: matches, votes, awards: [] });
        const badges = await computeBadges(db, 'P001');
        const b = badges.find(b => b.id === 'deckMaster');
        assert.equal(b.earned, false);
      });
    });

    describe('Voter', () => {
      it('bronze at 5 votes', async () => {
        const votes = [];
        for (let i = 1; i <= 5; i++) {
          votes.push({ season_id: 6, week: i, player_id: 'P001', leader_id: 'L1' });
        }
        const db = createMockDb({ attendance: [], season_standings: [], match_results: [], votes, awards: [] });
        const badges = await computeBadges(db, 'P001');
        const b = badges.find(b => b.id === 'voter');
        assert.equal(b.value, 5);
        assert.equal(b.tier, 'bronze');
      });

      it('silver at 10 votes', async () => {
        const votes = [];
        for (let i = 1; i <= 10; i++) {
          votes.push({ season_id: 6, week: i, player_id: 'P001', leader_id: 'L1' });
        }
        const db = createMockDb({ attendance: [], season_standings: [], match_results: [], votes, awards: [] });
        const badges = await computeBadges(db, 'P001');
        const b = badges.find(b => b.id === 'voter');
        assert.equal(b.value, 10);
        assert.equal(b.tier, 'silver');
      });

      it('gold at 20 votes', async () => {
        const votes = [];
        for (let i = 1; i <= 20; i++) {
          votes.push({ season_id: 6, week: i, player_id: 'P001', leader_id: 'L1' });
        }
        const db = createMockDb({ attendance: [], season_standings: [], match_results: [], votes, awards: [] });
        const badges = await computeBadges(db, 'P001');
        const b = badges.find(b => b.id === 'voter');
        assert.equal(b.value, 20);
        assert.equal(b.tier, 'gold');
      });

      it('not earned with 0 votes', async () => {
        const db = createMockDb({ attendance: [], season_standings: [], match_results: [], votes: [], awards: [] });
        const badges = await computeBadges(db, 'P001');
        const b = badges.find(b => b.id === 'voter');
        assert.equal(b.earned, false);
        assert.equal(b.tier, null);
      });

      it('counts across seasons', async () => {
        const votes = [];
        for (let i = 1; i <= 3; i++) {
          votes.push({ season_id: 5, week: i, player_id: 'P001', leader_id: 'L1' });
        }
        for (let i = 1; i <= 3; i++) {
          votes.push({ season_id: 6, week: i, player_id: 'P001', leader_id: 'L2' });
        }
        const db = createMockDb({ attendance: [], season_standings: [], match_results: [], votes, awards: [] });
        const badges = await computeBadges(db, 'P001');
        const b = badges.find(b => b.id === 'voter');
        assert.equal(b.value, 6);
        assert.equal(b.tier, 'bronze');
      });
    });
  });

  describe('edge cases', () => {
    it('player with no data gets all badges unearned', async () => {
      const db = createMockDb({ attendance: [], season_standings: [], match_results: [], votes: [], awards: [] });
      const badges = await computeBadges(db, 'P999');
      assert.equal(badges.length, 12);
      for (const b of badges) {
        assert.equal(b.earned, false, `${b.id} should not be earned`);
      }
    });

    it('returns exactly 12 badges', async () => {
      const db = createMockDb({ attendance: [], season_standings: [], match_results: [], votes: [], awards: [] });
      const badges = await computeBadges(db, 'P001');
      assert.equal(badges.length, 12);
      });
    });

    describe('Phase filtering', () => {
      it('attendance for cut/side events does not count toward First Night', async () => {
        const db = createMockDb({
          attendance: [{ season_id: 6, week: 12, player_id: 'P001' }],
          melee_tournaments: [
            { season_id: 6, round: 12, phase: 'cut' },
          ],
          season_standings: [],
          match_results: [],
          votes: [],
          awards: [],
        });
        const badges = await computeBadges(db, 'P001');
        const b = badges.find(b => b.id === 'firstNight');
        assert.equal(b.earned, false);
      });

      it('attendance for cut events does not count toward Attendance badge', async () => {
        const attendance = [];
        const melee_tournaments = [];
        for (let w = 1; w <= 10; w++) {
          attendance.push({ season_id: 6, week: w, player_id: 'P001' });
          melee_tournaments.push({ season_id: 6, round: w, phase: 'cut' });
        }
        const db = createMockDb({ attendance, melee_tournaments, season_standings: [], match_results: [], votes: [], awards: [] });
        const badges = await computeBadges(db, 'P001');
        const b = badges.find(b => b.id === 'attendance');
        assert.equal(b.value, 0);
        assert.equal(b.tier, null);
      });

      it('only regular-phase attendance counts toward Loyalist', async () => {
        const db = createMockDb({
          attendance: [
            { season_id: 4, week: 1, player_id: 'P001' },
            { season_id: 5, week: 1, player_id: 'P001' },
            { season_id: 6, week: 12, player_id: 'P001' },
          ],
          melee_tournaments: [
            { season_id: 4, round: 1, phase: 'regular' },
            { season_id: 5, round: 1, phase: 'regular' },
            { season_id: 6, round: 12, phase: 'cut' },
          ],
          season_standings: [],
          match_results: [],
          votes: [],
          awards: [],
        });
        const badges = await computeBadges(db, 'P001');
        const b = badges.find(b => b.id === 'loyalist');
        assert.equal(b.earned, false, 'cut event in season 6 should not count as a regular season');
      });
    });
  });
