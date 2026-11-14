import { badRequest } from './errors.js';

function compositeKey(...parts) {
  return parts.map(v => String(v)).join('|');
}

function playerNumber(id) {
  const m = /^P(\d+)$/.exec(String(id || ''));
  return m ? parseInt(m[1], 10) : 0;
}

// Deletes are keyed by id *and* a predicate on the orphan id so a repeated or
// concurrent plan becomes a no-op instead of destroying rows that already
// belong to the survivor.
function conditionalVoteDeletes(DB, row, orphanIdSet) {
  const statements = [];
  for (const column of ['player_id', 'opponent_id']) {
    if (orphanIdSet.has(row[column])) {
      statements.push(DB.prepare(`DELETE FROM votes WHERE id = ? AND ${column} = ?`).bind(row.id, row[column]));
    }
  }
  return statements;
}

function conditionalMatchDeletes(DB, row, orphanIdSet) {
  const statements = [];
  for (const column of ['player1_id', 'player2_id', 'winner_id']) {
    if (orphanIdSet.has(row[column])) {
      statements.push(DB.prepare(`DELETE FROM match_results WHERE id = ? AND ${column} = ?`).bind(row.id, row[column]));
    }
  }
  return statements;
}

// Match identity: Melee's id when we have it; otherwise the pairing in that round
// (a Swiss round pairs a player once), so two legacy NULL-id copies of the same
// match still collapse instead of double-counting.
function matchKey(seasonId, round, meleeMatchId, p1, p2) {
  if (meleeMatchId != null) return compositeKey('m', seasonId, round, meleeMatchId);
  const pair = [String(p1), String(p2)].sort();
  return compositeKey('p', seasonId, round, pair[0], pair[1]);
}

// Rows an admin would absorb by approving this merge — the confirmMerge gate's
// yardstick. Both sides of votes and matches count: a member recorded only as an
// opponent still owns a career that would silently move.
export async function countHeldRows(DB, playerId) {
  let total = 0;
  for (const table of ['season_standings', 'attendance', 'awards']) {
    const row = await DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE player_id = ?`).bind(playerId).first();
    total += Number(row?.n || 0);
  }
  for (const column of ['player_id', 'opponent_id']) {
    const row = await DB.prepare(`SELECT COUNT(*) AS n FROM votes WHERE ${column} = ?`).bind(playerId).first();
    total += Number(row?.n || 0);
  }
  for (const column of ['player1_id', 'player2_id']) {
    const row = await DB.prepare(`SELECT COUNT(*) AS n FROM match_results WHERE ${column} = ?`).bind(playerId).first();
    total += Number(row?.n || 0);
  }
  return total;
}

// Builds the statements that absorb `orphanIds` into `survivorId`. Reads the
// affected rows up front, drops orphan rows that would collide with a survivor
// row on a UNIQUE key (survivor wins), re-points the rest, moves each orphan's
// username history over, then deletes the orphans. Caller runs the returned
// statements as one DB.batch() so the merge is atomic.
//
// Every participant id is resolved through one orphan→survivor map, so a row
// that involves two orphans (A voted for B, A played B) is planned once and
// never points at a row that the same batch deletes.
//
// Self-references created by re-pointing (survivor voted for themselves,
// survivor paired against themselves) are deleted, never stored: a merge must
// not manufacture a self-vote.
export async function buildMergePlan(DB, survivorId, orphanIds) {
  const survivor = await DB.prepare('SELECT * FROM players WHERE id = ?').bind(survivorId).first();
  if (!survivor) return null;

  const ids = [...new Set(orphanIds)].filter(id => id && id !== survivorId);
  const orphans = [];
  for (const id of ids) {
    const orphan = await DB.prepare('SELECT * FROM players WHERE id = ?').bind(id).first();
    if (!orphan) return null;
    orphans.push(orphan);
  }
  if (orphans.length === 0) return null;

  // One email per row (players.email is UNIQUE among non-empty values), so a plan
  // cannot silently drop an address: two different emails need a human decision.
  const emails = new Set([survivor, ...orphans].filter(row => row.email).map(row => row.email.toLowerCase()));
  if (emails.size > 1) {
    throw badRequest('The rows carry different emails. Clear or move them before merging.');
  }

  const idMap = new Map(orphans.map(orphan => [orphan.id, survivorId]));
  const resolve = id => idMap.get(id) ?? id;
  const orphanIdSet = new Set(orphans.map(orphan => orphan.id));

  const deletes = [];
  const updates = [];
  const dependents = [];
  const summary = { votes: 0, standings: 0, matches: 0, attendance: 0, awards: 0, sessions: 0, usernames: 0, dropped: 0 };

  const survivorVoteKeys = new Set(
    ((await DB.prepare('SELECT season_id, week FROM votes WHERE player_id = ?').bind(survivorId).all()).results || [])
      .map(v => compositeKey(v.season_id, v.week))
  );
  const survivorStandingKeys = new Set(
    ((await DB.prepare('SELECT season_id, round FROM season_standings WHERE player_id = ?').bind(survivorId).all()).results || [])
      .map(r => compositeKey(r.season_id, r.round))
  );
  const survivorAttendanceKeys = new Set(
    ((await DB.prepare('SELECT season_id, week FROM attendance WHERE player_id = ?').bind(survivorId).all()).results || [])
      .map(r => compositeKey(r.season_id, r.week))
  );
  const survivorAwards = new Map(
    ((await DB.prepare('SELECT * FROM awards WHERE player_id = ?').bind(survivorId).all()).results || [])
      .map(r => [compositeKey(r.season_id, r.award_name), r])
  );
  const survivorMatchKeys = new Set();
  for (const column of ['player1_id', 'player2_id']) {
    const rows = (await DB.prepare(
      `SELECT season_id, round, melee_match_id, player1_id, player2_id FROM match_results WHERE ${column} = ?`
    ).bind(survivorId).all()).results || [];
    for (const row of rows) {
      survivorMatchKeys.add(matchKey(
        row.season_id, row.round, row.melee_match_id, resolve(row.player1_id), resolve(row.player2_id)
      ));
    }
  }
  const survivorDevices = new Set(
    ((await DB.prepare('SELECT device_id FROM sessions WHERE player_id = ?').bind(survivorId).all()).results || [])
      .map(row => row.device_id)
  );

  // A row can involve two orphans (A voted for B, A played B), so rows are
  // gathered across every orphan/column first and planned exactly once.
  const voteRows = new Map();
  for (const orphan of orphans) {
    for (const column of ['player_id', 'opponent_id']) {
      const rows = (await DB.prepare(`SELECT * FROM votes WHERE ${column} = ?`).bind(orphan.id).all()).results || [];
      for (const row of rows) voteRows.set(row.id, row);
    }
  }
  const matchRows = new Map();

  // Pass 1: drop rows that the merge turns into a self-vote, releasing the
  // survivor's week when it was their own row — otherwise a later duplicate check
  // would discard the orphan's real vote and lose the week entirely.
  for (const row of voteRows.values()) {
    if (resolve(row.player_id) !== resolve(row.opponent_id)) continue;
    deletes.push(...conditionalVoteDeletes(DB, row, orphanIdSet));
    if (row.player_id === survivorId) survivorVoteKeys.delete(compositeKey(row.season_id, row.week));
    summary.dropped++;
  }

  // Pass 2: re-point what survives, keeping one vote per (season, week).
  for (const row of voteRows.values()) {
    const newPlayer = resolve(row.player_id);
    const newOpponent = resolve(row.opponent_id);
    if (newPlayer === newOpponent) continue;
    const key = compositeKey(row.season_id, row.week);
    if (newPlayer === survivorId && survivorVoteKeys.has(key)) {
      deletes.push(...conditionalVoteDeletes(DB, row, orphanIdSet));
      summary.dropped++;
      continue;
    }
    if (newPlayer === survivorId) survivorVoteKeys.add(key);
    updates.push(DB.prepare('UPDATE votes SET player_id = ?, opponent_id = ? WHERE id = ?')
      .bind(newPlayer, newOpponent, row.id));
    summary.votes++;
  }

  for (const orphan of orphans) {
    const orphanId = orphan.id;

    for (const row of (await DB.prepare('SELECT * FROM season_standings WHERE player_id = ?').bind(orphanId).all()).results || []) {
      const key = compositeKey(row.season_id, row.round);
      if (survivorStandingKeys.has(key)) {
        deletes.push(DB.prepare('DELETE FROM season_standings WHERE season_id = ? AND round = ? AND player_id = ?')
          .bind(row.season_id, row.round, orphanId));
        summary.dropped++;
        continue;
      }
      survivorStandingKeys.add(key);
      updates.push(DB.prepare('UPDATE season_standings SET player_id = ? WHERE season_id = ? AND round = ? AND player_id = ?')
        .bind(survivorId, row.season_id, row.round, orphanId));
      summary.standings++;
    }

    for (const row of (await DB.prepare('SELECT * FROM attendance WHERE player_id = ?').bind(orphanId).all()).results || []) {
      const key = compositeKey(row.season_id, row.week);
      if (survivorAttendanceKeys.has(key)) {
        deletes.push(DB.prepare('DELETE FROM attendance WHERE season_id = ? AND week = ? AND player_id = ?')
          .bind(row.season_id, row.week, orphanId));
        summary.dropped++;
        continue;
      }
      survivorAttendanceKeys.add(key);
      updates.push(DB.prepare('UPDATE attendance SET player_id = ? WHERE season_id = ? AND week = ? AND player_id = ?')
        .bind(survivorId, row.season_id, row.week, orphanId));
      summary.attendance++;
    }

    for (const row of (await DB.prepare('SELECT * FROM awards WHERE player_id = ?').bind(orphanId).all()).results || []) {
      const key = compositeKey(row.season_id, row.award_name);
      const existing = survivorAwards.get(key);
      if (existing) {
        // A podium place must not be lost to duplicate-row bookkeeping: keep the
        // better rank, including for past seasons that never resync.
        if (row.rank != null && (existing.rank == null || row.rank < existing.rank)) {
          updates.push(DB.prepare('UPDATE awards SET score = ?, rank = ? WHERE season_id = ? AND award_name = ? AND player_id = ?')
            .bind(row.score ?? existing.score ?? null, row.rank, row.season_id, row.award_name, survivorId));
          existing.rank = row.rank;
        }
        deletes.push(DB.prepare('DELETE FROM awards WHERE season_id = ? AND award_name = ? AND player_id = ?')
          .bind(row.season_id, row.award_name, orphanId));
        summary.dropped++;
        continue;
      }
      survivorAwards.set(key, row);
      updates.push(DB.prepare('UPDATE awards SET player_id = ? WHERE season_id = ? AND award_name = ? AND player_id = ?')
        .bind(survivorId, row.season_id, row.award_name, orphanId));
      summary.awards++;
    }

    for (const column of ['player1_id', 'player2_id', 'winner_id']) {
      const rows = (await DB.prepare(`SELECT * FROM match_results WHERE ${column} = ?`).bind(orphanId).all()).results || [];
      for (const row of rows) matchRows.set(row.id, row);
    }

    for (const row of (await DB.prepare('SELECT token, device_id FROM sessions WHERE player_id = ?').bind(orphanId).all()).results || []) {
      if (survivorDevices.has(row.device_id)) {
        dependents.push(DB.prepare('DELETE FROM sessions WHERE token = ?').bind(row.token));
      } else {
        updates.push(DB.prepare('UPDATE sessions SET player_id = ? WHERE token = ?').bind(survivorId, row.token));
        survivorDevices.add(row.device_id);
      }
      summary.sessions++;
    }

    for (const row of (await DB.prepare('SELECT id, status FROM rename_requests WHERE player_id = ?').bind(orphanId).all()).results || []) {
      if (row.status === 'pending') {
        dependents.push(DB.prepare('DELETE FROM rename_requests WHERE id = ?').bind(row.id));
      } else {
        updates.push(DB.prepare('UPDATE rename_requests SET player_id = ? WHERE id = ?').bind(survivorId, row.id));
      }
    }

    const orphanUsernames = (await DB.prepare('SELECT * FROM player_usernames WHERE player_id = ?').bind(orphanId).all()).results || [];
    const seen = new Set(orphanUsernames.map(r => r.name_lower));
    if (orphan.melee_name && !seen.has(orphan.melee_name.toLowerCase())) {
      orphanUsernames.push({ melee_name: orphan.melee_name, name_lower: orphan.melee_name.toLowerCase(), source: 'merge', first_seen: null });
    }
    const now = new Date().toISOString();
    for (const row of orphanUsernames) {
      const source = row.melee_name === orphan.melee_name ? 'merge' : (row.source || 'merge');
      updates.push(DB.prepare(
        'INSERT OR IGNORE INTO player_usernames (player_id, melee_name, name_lower, source, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(survivorId, row.melee_name, row.name_lower || row.melee_name.toLowerCase(), source, row.first_seen ?? null, now));
      summary.usernames++;
    }
    if (orphanUsernames.length > 0) {
      dependents.push(DB.prepare('DELETE FROM player_usernames WHERE player_id = ?').bind(orphanId));
    }

    if (orphan.email && !survivor.email) {
      // Release the address before the survivor claims it: players.email is UNIQUE
      // among non-empty values, and the orphan row still exists at this point.
      updates.push(DB.prepare('UPDATE players SET email = ? WHERE id = ?').bind(null, orphanId));
      updates.push(DB.prepare('UPDATE players SET email = ? WHERE id = ?').bind(orphan.email, survivorId));
      survivor.email = orphan.email;
    }
    if (!survivor.melee_guid && orphan.melee_guid) {
      updates.push(DB.prepare('UPDATE players SET melee_guid = ? WHERE id = ?').bind(orphan.melee_guid, survivorId));
      survivor.melee_guid = orphan.melee_guid;
    }
    if (orphan.active === 1 && survivor.active !== 1) {
      updates.push(DB.prepare('UPDATE players SET active = 1 WHERE id = ?').bind(survivorId));
      survivor.active = 1;
    }

    dependents.push(DB.prepare('DELETE FROM players WHERE id = ?').bind(orphanId));
  }

  for (const row of matchRows.values()) {
    const newP1 = resolve(row.player1_id);
    const newP2 = resolve(row.player2_id);
    if (newP1 === newP2) {
      deletes.push(...conditionalMatchDeletes(DB, row, orphanIdSet));
      summary.dropped++;
      continue;
    }
    const key = matchKey(row.season_id, row.round, row.melee_match_id, newP1, newP2);
    if (survivorMatchKeys.has(key)) {
      deletes.push(...conditionalMatchDeletes(DB, row, orphanIdSet));
      summary.dropped++;
      continue;
    }
    survivorMatchKeys.add(key);
    updates.push(DB.prepare('UPDATE match_results SET player1_id = ?, player2_id = ?, winner_id = ? WHERE id = ?').bind(
      newP1,
      newP2,
      resolve(row.winner_id),
      row.id
    ));
    summary.matches++;
  }

  // A merged-away row may be the highest id; keep the sequence above it so a
  // later auto-create cannot recycle the id of a deleted player. The stored value
  // only ever moves up — a smaller later merge must not re-open retired ids.
  const seqRow = await DB.prepare("SELECT value FROM settings WHERE key = 'PLAYER_SEQ'").first();
  const storedSeq = Number.parseInt(seqRow?.value ?? '0', 10) || 0;
  const orphanMax = orphans.reduce((max, orphan) => Math.max(max, playerNumber(orphan.id)), 0);
  const nextSeq = Math.max(storedSeq, orphanMax);
  if (nextSeq > storedSeq) {
    dependents.push(DB.prepare(
      "INSERT OR REPLACE INTO settings (key, value) VALUES ('PLAYER_SEQ', ?)"
    ).bind(String(nextSeq)));
  }

  return { statements: [...deletes, ...updates, ...dependents], summary, survivor, orphans };
}

export function mergeNote(summary) {
  return `merged: votes ${summary.votes}, standings ${summary.standings}, matches ${summary.matches}, `
    + `attendance ${summary.attendance}, awards ${summary.awards}, usernames ${summary.usernames}, `
    + `dropped ${summary.dropped} duplicate row(s), sessions ${summary.sessions}`;
}
