import { Router } from 'express';
import crypto from 'crypto';
import { query } from '../db';
import { SUPER_ADMIN_EMAIL } from '../config';
import { requireSuperAdmin } from '../middleware/auth';
import { listLiveAdminSessions } from '../services/admin-sessions';
import { getPlaybackLogCapacity, getPlaybackLogPath, listPlaybackLogs } from '../services/playback-logs';
import { getAdminQueueStatus } from '../services/queue-status';
import { getTransportLogCapacity, getTransportLogPath, listTransportLogs } from '../services/transport-logs';
import type { AdminQueueStatus, AdminUserRow, AdminTokenRow } from '../../../shared/types';

const router = Router();

router.get('/admin/users', requireSuperAdmin, async (_req, res) => {
  const r = await query<AdminUserRow>(`
    SELECT u.id, u.email, u.created_at,
           t.token, t.label, t.created_at AS token_created_at,
           t.used_at, t.revoked_at
    FROM users u
    LEFT JOIN invite_tokens t ON t.used_by_user_id = u.id
    WHERE u.email != $1
    ORDER BY u.created_at DESC
  `, [SUPER_ADMIN_EMAIL]);

  res.json({ users: r.rows });
});

router.get('/admin/tokens', requireSuperAdmin, async (_req, res) => {
  const r = await query<AdminTokenRow>(`
    SELECT token, label, created_at, used_at, revoked_at,
           (SELECT email FROM users WHERE id = used_by_user_id) AS used_by_email
    FROM invite_tokens
    ORDER BY created_at DESC
  `);

  for (const row of r.rows) {
    row.can_manage = !row.used_by_email || row.used_by_email.toLowerCase() !== SUPER_ADMIN_EMAIL;
  }

  res.json({ tokens: r.rows });
});

router.post('/admin/tokens', requireSuperAdmin, async (req, res) => {
  const { label } = req.body || {};
  const token = crypto.randomBytes(18).toString('base64url');

  await query(
    'INSERT INTO invite_tokens (token, label) VALUES ($1, $2)',
    [token, label || null]
  );

  const r = await query<{ token: string; label: string | null; created_at: number }>(
    'SELECT token, label, created_at FROM invite_tokens WHERE token = $1',
    [token]
  );

  res.json(r.rows[0]);
});

router.delete('/admin/tokens/:token', requireSuperAdmin, async (req, res) => {
  const { token } = req.params;

  const existingRes = await query<{ used_at: number | null; used_by_email: string | null }>(
    `SELECT t.used_at,
            (SELECT email FROM users WHERE id = t.used_by_user_id) AS used_by_email
     FROM invite_tokens t
     WHERE t.token = $1 AND t.revoked_at IS NULL`,
    [token]
  );
  const existing = existingRes.rows[0];

  if (!existing) {
    return res.status(404).json({ error: 'token_not_found_or_already_revoked' });
  }
  if (existing.used_by_email && existing.used_by_email.toLowerCase() === SUPER_ADMIN_EMAIL) {
    return res.status(403).json({ error: 'cannot_modify_super_admin_token' });
  }

  await query(
    "UPDATE invite_tokens SET revoked_at = EXTRACT(EPOCH FROM NOW())::BIGINT WHERE token = $1 AND revoked_at IS NULL",
    [token]
  );

  res.json({ ok: true, was_used: existing.used_at !== null });
});

router.patch('/admin/tokens/:token/reactivate', requireSuperAdmin, async (req, res) => {
  const { token } = req.params;

  const existingRes = await query<{ used_at: number | null; used_by_email: string | null }>(
    `SELECT t.used_at,
            (SELECT email FROM users WHERE id = t.used_by_user_id) AS used_by_email
     FROM invite_tokens t
     WHERE t.token = $1 AND t.revoked_at IS NOT NULL`,
    [token]
  );
  const existing = existingRes.rows[0];

  if (!existing) {
    return res.status(404).json({ error: 'token_not_found_or_not_revoked' });
  }
  if (existing.used_by_email && existing.used_by_email.toLowerCase() === SUPER_ADMIN_EMAIL) {
    return res.status(403).json({ error: 'cannot_modify_super_admin_token' });
  }

  await query(
    'UPDATE invite_tokens SET revoked_at = NULL WHERE token = $1 AND revoked_at IS NOT NULL',
    [token]
  );

  res.json({ ok: true, was_used: existing.used_at !== null });
});

router.delete('/admin/tokens/:token/permanent', requireSuperAdmin, async (req, res) => {
  const { token } = req.params;

  const existingRes = await query<{ used_at: number | null; used_by_email: string | null }>(
    `SELECT t.used_at,
            (SELECT email FROM users WHERE id = t.used_by_user_id) AS used_by_email
     FROM invite_tokens t
     WHERE t.token = $1`,
    [token]
  );
  const existing = existingRes.rows[0];

  if (!existing) {
    return res.status(404).json({ error: 'token_not_found' });
  }
  if (existing.used_by_email && existing.used_by_email.toLowerCase() === SUPER_ADMIN_EMAIL) {
    return res.status(403).json({ error: 'cannot_modify_super_admin_token' });
  }

  await query('DELETE FROM invite_tokens WHERE token = $1', [token]);

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
