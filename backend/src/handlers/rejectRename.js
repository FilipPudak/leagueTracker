import { requireAdmin } from '../lib/auth.js';
import { badRequest } from '../lib/errors.js';

export async function handleRejectRename(body, env) {
  requireAdmin(body, env);
  const { DB } = env;

  if (body.requestId == null) throw badRequest('requestId is required.');
  const request = await DB.prepare('SELECT * FROM rename_requests WHERE id = ?').bind(body.requestId).first();
  if (!request) throw badRequest('Rename request not found.');
  if (request.status === 'rejected') {
    return { id: request.id, status: 'rejected', alreadyRejected: true };
  }
  if (request.status !== 'pending') {
    throw badRequest(`Rename request is already ${request.status}.`);
  }

  const note = typeof body.note === 'string' ? body.note.slice(0, 500) : null;
  await DB.prepare(
    'UPDATE rename_requests SET status = ?, resolved_at = ?, resolved_by = ?, note = ? WHERE id = ?'
  ).bind('rejected', new Date().toISOString(), 'admin', note, request.id).run();

  return { id: request.id, status: 'rejected' };
}
