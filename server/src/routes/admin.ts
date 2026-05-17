import { Router } from 'express';
import crypto from 'crypto';
import { sql } from 'kysely';
import { kdb } from '../db';
import { SUPER_ADMIN_EMAIL } from '../config';
import { requireSuperAdmin } from '../middleware/auth';
import { listLiveAdminSessions } from '../services/admin-sessions';
import { getPlaybackLogCapacity, getPlaybackLogPath, listPlaybackLogs } from '../services/playback-logs';
import { getAdminQueueStatus } from '../services/queue-status';
import { getTransportLogCapacity, getTransportLogPath, listTransportLogs } from '../services/transport-logs';
import type { AdminQueueStatus, AdminTokenRow } from '../../../shared/types';

const router = Router();

router.get('/admin/users', requireSuperAdmin, async (_req, res) => {
  const users = await kdb
    .selectFrom('users as u')
    .leftJoin('invite_tokens as t', 't.used_by_user_id', 'u.id')
    .select([
      'u.id', 'u.email', 'u.created_at',
      't.token', 't.label',
      't.created_at as token_created_at',
      't.used_at', 't.revoked_at'
    ])
    .where('u.email', '!=', SUPER_ADMIN_EMAIL)
    .orderBy('u.created_at', 'desc')
    .execute();

  res.json({ users });
});

router.get('/admin/tokens', requireSuperAdmin, async (_req, res) => {
  const tokens = await kdb
    .selectFrom('invite_tokens')
    .select([
      'token', 'label', 'created_at', 'used_at', 'revoked_at',
      (eb) => eb
        .selectFrom('users')
        .select('email')
        .whereRef('users.id', '=', 'invite_tokens.used_by_user_id')
        .as('used_by_email')
    ])
    .orderBy('created_at', 'desc')
    .execute() as AdminTokenRow[];

  for (const row of tokens) {
    row.can_manage = !row.used_by_email || row.used_by_email.toLowerCase() !== SUPER_ADMIN_EMAIL;
  }

  res.json({ tokens });
});

router.post('/admin/tokens', requireSuperAdmin, async (req, res) => {
  const { label } = req.body || {};
  const token = crypto.randomBytes(18).toString('base64url');

  await kdb
    .insertInto('invite_tokens')
    .values({ token, label: label || null })
    .execute();

  const row = await kdb
    .selectFrom('invite_tokens')
    .select(['token', 'label', 'created_at'])
    .where('token', '=', token)
    .executeTakeFirstOrThrow();

  res.json(row);
});

router.delete('/admin/tokens/:token', requireSuperAdmin, async (req, res) => {
  const { token } = req.params;

  const existing = await kdb
    .selectFrom('invite_tokens as t')
    .select([
      't.used_at',
      (eb) => eb
        .selectFrom('users')
        .select('email')
        .whereRef('users.id', '=', 't.used_by_user_id')
        .as('used_by_email')
    ])
    .where('t.token', '=', token)
    .where('t.revoked_at', 'is', null)
    .executeTakeFirst();

  if (!existing) {
    return res.status(404).json({ error: 'token_not_found_or_already_revoked' });
  }
  if (existing.used_by_email && existing.used_by_email.toLowerCase() === SUPER_ADMIN_EMAIL) {
    return res.status(403).json({ error: 'cannot_modify_super_admin_token' });
  }

  await kdb
    .updateTable('invite_tokens')
    .set({ revoked_at: sql<number>`EXTRACT(EPOCH FROM NOW())::BIGINT` })
    .where('token', '=', token)
    .where('revoked_at', 'is', null)
    .execute();

  res.json({ ok: true, was_used: existing.used_at !== null });
});

router.patch('/admin/tokens/:token/reactivate', requireSuperAdmin, async (req, res) => {
  const { token } = req.params;

  const existing = await kdb
    .selectFrom('invite_tokens as t')
    .select([
      't.used_at',
      (eb) => eb
        .selectFrom('users')
        .select('email')
        .whereRef('users.id', '=', 't.used_by_user_id')
        .as('used_by_email')
    ])
    .where('t.token', '=', token)
    .where('t.revoked_at', 'is not', null)
    .executeTakeFirst();

  if (!existing) {
    return res.status(404).json({ error: 'token_not_found_or_not_revoked' });
  }
  if (existing.used_by_email && existing.used_by_email.toLowerCase() === SUPER_ADMIN_EMAIL) {
    return res.status(403).json({ error: 'cannot_modify_super_admin_token' });
  }

  await kdb
    .updateTable('invite_tokens')
    .set({ revoked_at: null })
    .where('token', '=', token)
    .where('revoked_at', 'is not', null)
    .execute();

  res.json({ ok: true, was_used: existing.used_at !== null });
});

router.delete('/admin/tokens/:token/permanent', requireSuperAdmin, async (req, res) => {
  const { token } = req.params;

  const existing = await kdb
    .selectFrom('invite_tokens as t')
    .select([
      't.used_at',
      (eb) => eb
        .selectFrom('users')
        .select('email')
        .whereRef('users.id', '=', 't.used_by_user_id')
        .as('used_by_email')
    ])
    .where('t.token', '=', token)
    .executeTakeFirst();

  if (!existing) {
    return res.status(404).json({ error: 'token_not_found' });
  }
  if (existing.used_by_email && existing.used_by_email.toLowerCase() === SUPER_ADMIN_EMAIL) {
    return res.status(403).json({ error: 'cannot_modify_super_admin_token' });
  }

  await kdb.deleteFrom('invite_tokens').where('token', '=', token).execute();

  res.json({ ok: true, was_used: existing.used_at !== null });
});

router.get('/admin/sessions', requireSuperAdmin, async (_req, res) => {
  res.json({ sessions: await listLiveAdminSessions() });
});

router.get('/admin/playback-logs', requireSuperAdmin, (_req, res) => {
  const logs = listPlaybackLogs();
  res.json({
    count: logs.length,
    capacity: getPlaybackLogCapacity(),
    path: getPlaybackLogPath(),
    logs
  });
});

router.get('/admin/transport-logs', requireSuperAdmin, (_req, res) => {
  const logs = listTransportLogs();
  res.json({
    count: logs.length,
    capacity: getTransportLogCapacity(),
    path: getTransportLogPath(),
    logs
  });
});

router.get('/admin/queue-status', requireSuperAdmin, async (_req, res) => {
  try {
    const status = await getAdminQueueStatus() as AdminQueueStatus;
    res.json(status);
  } catch (error) {
    console.error('[admin/queue-status]', error);
    res.status(503).json({ error: 'queue_status_unavailable' });
  }
});

export default router;
