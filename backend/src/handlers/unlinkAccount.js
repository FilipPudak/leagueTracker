import { deleteSessionsByPlayerAndDevice, findSessionByToken } from '../lib/auth.js';
import { getPlayerById } from '../db/queries.js';

export async function handleUnlinkAccount(body, env) {
  const { DB } = env;
  const { token } = body;

  if (!token) {
    const err = new Error('Token required.');
    err.status = 400;
    throw err;
  }

  const session = await findSessionByToken(DB, token);
  if (!session) {
    const err = new Error('Session not found.');
    err.status = 404;
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
