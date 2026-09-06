import { deleteSessionsByPlayerAndDevice } from '../lib/auth.js';
import { getPlayerById } from '../db/queries.js';

export async function handleUnlinkAccount(body, env, session) {
  const { DB } = env;

  if (!session) {
    const err = new Error('Session expired. Please re-link to continue.');
    err.status = 401;
    throw err;
  }

  const player = await getPlayerById(DB, session.player_id);

  // Delete all sessions for this player+device combo
  await deleteSessionsByPlayerAndDevice(DB, session.player_id, session.device_id);

  return {
    success: true,
    playerName: player ? player.name : null,
  };
}
