// League data engine (P4): one implementation of the round-data pipeline
// shared by the cron sync and the admin backfill wrappers.
//
// Engine boundary (hard rules): writes only players / melee_tournaments /
// season_standings / match_results / attendance. Never settings, never awards,
// never listTournaments, never season lifecycle.

import { createPlayerFinder } from './meleeLeague.js';
import { auditVotesForWeek } from './voteAudit.js';
import { PHASE } from './constants.js';

// D1 run/batch results carry meta.changes; the test mock carries changes.
function changesOf(res) {
  return res?.meta?.changes ?? res?.changes ?? 0;
}

function sumChanges(results, skip = 0) {
  return results.slice(skip).reduce((sum, res) => sum + changesOf(res), 0);
}

// Higher game wins wins; equal game wins is a draw (winnerId null).
export function decideWinner(p1Wins, p2Wins, p1Id, p2Id) {
  if (p1Wins > p2Wins) return p1Id;
  if (p2Wins > p1Wins) return p2Id;
  return null;
}

// Melee player name fallback chain: DisplayName → Name → username.
export function resolveMeleeName(meleePlayer, username) {
  return meleePlayer?.DisplayName || meleePlayer?.Name || username;
}

// Resolves both competitor slots to roster player ids (auto-creating unknown
// Melee names via the finder — invariant 4). Returns null when either slot
// lacks a username or a competitor is missing.
export async function resolveMatchCompetitors(comps, finder) {
  const p1Player = comps?.[0]?.Team?.Players?.[0];
  const p2Player = comps?.[1]?.Team?.Players?.[0];
  const p1Username = p1Player?.Username;
  const p2Username = p2Player?.Username;
  if (!p1Username || !p2Username) return null;

  const p1Id = await finder.find(p1Username, resolveMeleeName(p1Player, p1Username));
  const p2Id = await finder.find(p2Username, resolveMeleeName(p2Player, p2Username));
  return { p1Id, p2Id };
}

// Per-round order (hard invariant):
// skip check → fetch standings → resolve players → attended set from RESPONSE
// → batch replace standings → write attendance (regular, ≤ maxAttendanceWeek)
// → fetch matches → batch replace matches → audit (if opted in and complete).
export async function syncSeasonData(DB, client, {
  seasonId,
  weekMap,
  budget = Infinity,
  force = false,
  reactivate = false,
  auditVotes = false,
  maxAttendanceWeek = Infinity,
  logPrefix = '[Sync]',
} = {}) {
  const result = {
    seasonId,
    fetchFailed: false,
    tournamentsInserted: 0,
    standingsRows: 0,
    matchesRows: 0,
    attendanceRows: 0,
    roundsProcessed: 0,
    roundsSkipped: 0,
    roundsPartial: 0,
    roundsResynced: 0,
    newlySyncedRounds: [],
    roundAttendance: new Map(),
    roundPhases: new Map(),
    createdPlayers: [],
  };

  const createdPlayers = new Map();
  const finder = createPlayerFinder(DB, { onCreated: p => createdPlayers.set(p.id, p) });

  for (const [meleeId, info] of weekMap) {
    try {
      const res = await DB.prepare(
        'INSERT OR IGNORE INTO melee_tournaments (melee_id, season_id, round, name, date, phase) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(meleeId, seasonId, info.round, info.name, info.date, info.phase || PHASE.REGULAR).run();
      result.tournamentsInserted += changesOf(res);
    } catch (err) {
      console.error(`${logPrefix} Failed to insert tournament ${meleeId}: ${err.message}`);
    }
  }

  const standingsInSeason = await DB.prepare(
    'SELECT DISTINCT round FROM season_standings WHERE season_id = ?'
  ).bind(seasonId).all();
  const syncedStandingsRounds = new Set((standingsInSeason.results || []).map(r => r.round));

  const matchesInSeason = await DB.prepare(
    'SELECT DISTINCT round FROM match_results WHERE season_id = ?'
  ).bind(seasonId).all();
  const syncedMatchesRounds = new Set((matchesInSeason.results || []).map(r => r.round));

  const processedRounds = new Set();

  for (const [meleeId, info] of weekMap) {
    const round = info.round;
    if (processedRounds.has(round)) continue;
    if (!force && syncedStandingsRounds.has(round) && syncedMatchesRounds.has(round)) {
      result.roundsSkipped++;
      continue;
    }
    if (result.roundsProcessed >= budget) break;

    result.roundsProcessed++;
    if (force) result.roundsResynced++;
    processedRounds.add(round);
    const phase = info.phase || PHASE.REGULAR;

    let standingsResp;
    try {
      standingsResp = await client.getStandings(meleeId);
    } catch (err) {
      console.error(`${logPrefix} Failed to get standings for tournament ${meleeId}: ${err.message}`);
      result.roundsPartial++;
      continue;
    }

    const attendedThisRound = new Set();
    const standingRows = [];
    for (const s of (standingsResp.Content || [])) {
      const meleePlayer = s.Team?.Players?.[0];
      const username = meleePlayer?.Username;
      if (!username) continue;
      const playerId = await finder.find(username, resolveMeleeName(meleePlayer, username));
      attendedThisRound.add(playerId);
      standingRows.push([seasonId, round, playerId, s.MatchWins || 0, s.MatchLosses || 0, s.MatchDraws || 0, s.Points || 0, s.Rank || null]);
    }

    try {
      const stmts = [
        DB.prepare('DELETE FROM season_standings WHERE season_id = ? AND round = ?').bind(seasonId, round),
        ...standingRows.map(row => DB.prepare(
          'INSERT INTO season_standings (season_id, round, player_id, wins, losses, draws, match_points, rank) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(...row)),
      ];
      const writeResults = await DB.batch(stmts);
      result.standingsRows += sumChanges(writeResults, 1);
    } catch (err) {
      console.error(`${logPrefix} Failed to write standings for round ${round}: ${err.message}`);
      result.roundsPartial++;
      continue;
    }

    result.roundAttendance.set(round, attendedThisRound);
    result.roundPhases.set(round, phase);

    if (phase === PHASE.REGULAR && round <= maxAttendanceWeek && attendedThisRound.size > 0) {
      try {
        const stmts = [...attendedThisRound].map(playerId => DB.prepare(
          'INSERT OR IGNORE INTO attendance (season_id, week, player_id) VALUES (?, ?, ?)'
        ).bind(seasonId, round, playerId));
        const writeResults = await DB.batch(stmts);
        result.attendanceRows += sumChanges(writeResults);
      } catch (err) {
        console.error(`${logPrefix} Failed to record attendance for round ${round}: ${err.message}`);
      }
    }

    let matchesResp;
    try {
      matchesResp = await client.getMatches(meleeId);
    } catch (err) {
      console.error(`${logPrefix} Failed to get matches for tournament ${meleeId}: ${err.message}`);
      result.roundsPartial++;
      continue;
    }

    const matchStmts = [
      DB.prepare('DELETE FROM match_results WHERE season_id = ? AND round = ?').bind(seasonId, round),
    ];
    for (const m of (matchesResp.Content || [])) {
      const comps = m.Competitors || [];
      if (comps.length < 2) continue;

      const ids = await resolveMatchCompetitors(comps, finder);
      if (!ids) continue;

      const winnerId = decideWinner(comps[0].GameWins || 0, comps[1].GameWins || 0, ids.p1Id, ids.p2Id);
      const matchGuid = m.Guid || m.ID;
      matchStmts.push(DB.prepare(
        'INSERT INTO match_results (season_id, round, melee_match_id, player1_id, player2_id, winner_id, result, is_bye) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(seasonId, round, matchGuid, ids.p1Id, ids.p2Id, winnerId, m.ResultString || null, m.ByeReason ? 1 : 0));
    }

    try {
      const writeResults = await DB.batch(matchStmts);
      result.matchesRows += sumChanges(writeResults, 1);
    } catch (err) {
      console.error(`${logPrefix} Failed to write matches for round ${round}: ${err.message}`);
      result.roundsPartial++;
      continue;
    }

    result.newlySyncedRounds.push(round);

    if (auditVotes) {
      try {
        const audit = await auditVotesForWeek(DB, seasonId, round);
        if (audit.total > 0) {
          if (audit.nonAttendees.length > 0 || audit.notFaced.length > 0) {
            console.warn(`[VoteAudit] S${seasonId} W${round}: ${audit.total} votes; non-attendee ${audit.nonAttendees.length} [${audit.nonAttendees.join(', ')}]; opponent-not-faced ${audit.notFaced.length} [${audit.notFaced.join(', ')}]`);
          } else {
            console.log(`[VoteAudit] S${seasonId} W${round}: ${audit.total} votes reconciled, no violations`);
          }
        }
      } catch (err) {
        console.error(`${logPrefix} Vote audit failed for week ${round}: ${err.message}`);
      }
    }
  }

  if (reactivate) {
    const allAttended = new Set([...result.roundAttendance.values()].flatMap(s => [...s]));
    if (allAttended.size > 0) {
      const playersResult = await DB.prepare('SELECT id, active FROM players').all();
      for (const player of (playersResult.results || [])) {
        if (allAttended.has(player.id) && player.active !== 1) {
          try {
            await DB.prepare('UPDATE players SET active = ? WHERE id = ?').bind(1, player.id).run();
          } catch (err) {
            console.error(`${logPrefix} Failed to activate player ${player.id}: ${err.message}`);
          }
        }
      }
    }
  }

  result.createdPlayers = [...createdPlayers.values()];
  return result;
}
