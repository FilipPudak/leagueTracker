import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMockDb } from './mock-db.js';

const STANDING_SQL = 'INSERT INTO season_standings (season_id, round, player_id, wins, losses, draws, match_points, rank) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
const ATTENDANCE_SQL = 'INSERT INTO attendance (season_id, week, player_id) VALUES (?, ?, ?)';

describe('helpers/mock-db (P4 Phase 0)', () => {
  it('T0.1 constrains duplicate season_standings (season_id, round, player_id)', async () => {
    const db = createMockDb({ season_standings: [] });
    const insert = () => db.prepare(STANDING_SQL).bind(6, 1, 'P001', 1, 0, 0, 3, 1).run();
    await insert();
    await assert.rejects(insert(), /UNIQUE constraint failed: season_standings/);
    assert.equal(db.getStore().season_standings.length, 1);
  });

  it('T0.1 allows the same player on a different round', async () => {
    const db = createMockDb({ season_standings: [] });
    await db.prepare(STANDING_SQL).bind(6, 1, 'P001', 1, 0, 0, 3, 1).run();
    await db.prepare(STANDING_SQL).bind(6, 2, 'P001', 0, 1, 0, 0, 2).run();
    assert.equal(db.getStore().season_standings.length, 2);
  });

  it('T0.2 constrains duplicate attendance (season_id, week, player_id)', async () => {
    const db = createMockDb({ attendance: [] });
    const insert = () => db.prepare(ATTENDANCE_SQL).bind(6, 1, 'P001').run();
    await insert();
    await assert.rejects(insert(), /UNIQUE constraint failed: attendance/);
    assert.equal(db.getStore().attendance.length, 1);
  });

  it('T0.2 INSERT OR IGNORE stays silent on duplicate attendance', async () => {
    const db = createMockDb({ attendance: [] });
    await db.prepare(ATTENDANCE_SQL).bind(6, 1, 'P001').run();
    const res = await db.prepare('INSERT OR IGNORE INTO attendance (season_id, week, player_id) VALUES (?, ?, ?)').bind(6, 1, 'P001').run();
    assert.equal(res.changes, 0);
    assert.equal(db.getStore().attendance.length, 1);
  });

  it('T0.3 batch() rolls back the store when a later statement throws', async () => {
    const db = createMockDb({ attendance: [] });
    const ok = db.prepare(ATTENDANCE_SQL).bind(6, 1, 'P001');
    const dup = db.prepare(ATTENDANCE_SQL).bind(6, 1, 'P001');
    await assert.rejects(() => db.batch([ok, dup]), /UNIQUE constraint failed/);
    assert.equal(db.getStore().attendance.length, 0);
  });

  it('T0.3 batch() keeps pre-batch rows on rollback', async () => {
    const db = createMockDb({ attendance: [{ season_id: 6, week: 0, player_id: 'P000' }] });
    const ok = db.prepare(ATTENDANCE_SQL).bind(6, 2, 'P002');
    const dup = db.prepare(ATTENDANCE_SQL).bind(6, 0, 'P000');
    await assert.rejects(() => db.batch([ok, dup]), /UNIQUE constraint failed/);
    assert.equal(db.getStore().attendance.length, 1);
    assert.equal(db.getStore().attendance[0].player_id, 'P000');
  });

  it('T0.4 batch() returns per-statement results on success', async () => {
    const db = createMockDb({ attendance: [] });
    const results = await db.batch([
      db.prepare(ATTENDANCE_SQL).bind(6, 1, 'P001'),
      db.prepare(ATTENDANCE_SQL).bind(6, 1, 'P002'),
    ]);
    assert.equal(results.length, 2);
    assert.ok(results.every(r => r.success));
    assert.equal(db.getStore().attendance.length, 2);
  });

  it('T0.4 tags calls issued from batch() with viaBatch', async () => {
    const db = createMockDb({ attendance: [] });
    await db.batch([db.prepare(ATTENDANCE_SQL).bind(6, 1, 'P001')]);
    await db.prepare('SELECT * FROM attendance').all();
    const batchCalls = db.getCalls().filter(c => c.viaBatch === true);
    const directCalls = db.getCalls().filter(c => c.viaBatch !== true);
    assert.equal(batchCalls.length, 1);
    assert.equal(batchCalls[0].sql, ATTENDANCE_SQL);
    assert.equal(directCalls.length, 1);
  });
});
