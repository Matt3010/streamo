import { Router } from 'express';
import crypto from 'crypto';
import { db } from '../db';
import { SUPER_ADMIN_EMAIL } from '../config';
import { requireSuperAdmin } from '../middleware/auth';
import type { AdminUserRow, AdminTokenRow, AdminSession } from '../../../shared/types';

const router = Router();

// GET /admin/users - List all users with their token status (excludes super admin)
router.get('/admin/users', requireSuperAdmin, (_req, res) => {
  const rows = db.prepare(`
    SELECT u.id, u.email, u.created_at,
           t.token, t.label, t.created_at AS token_created_at,
           t.used_at, t.revoked_at
    FROM users u
    LEFT JOIN invite_tokens t ON t.used_by_user_id = u.id
    WHERE u.email != ?
    ORDER BY u.created_at DESC
  `).all(SUPER_ADMIN_EMAIL) as AdminUserRow[];

  res.json({ users: rows });
});

// GET /admin/tokens - List all invite tokens
router.get('/admin/tokens', requireSuperAdmin, (_req, res) => {
  const rows = db.prepare(`
    SELECT token, label, created_at, used_at, revoked_at,
           (SELECT email FROM users WHERE id = used_by_user_id) AS used_by_email
    FROM invite_tokens
    ORDER BY created_at DESC
  `).all() as AdminTokenRow[];

  res.json({ tokens: rows });
});

// POST /admin/tokens - Generate a new invite token
router.post('/admin/tokens', requireSuperAdmin, (req, res) => {
  const { label } = req.body || {};
  const token = crypto.randomBytes(18).toString('base64url');

  db.prepare(
    'INSERT INTO invite_tokens (token, label) VALUES (?, ?)'
  ).run(token, label || null);

  const row = db.prepare(
    'SELECT token, label, created_at FROM invite_tokens WHERE token = ?'
  ).get(token) as { token: string; label: string | null; created_at: number };

  res.json(row);
});

// DELETE /admin/tokens/:token - Revoke a token
router.delete('/admin/tokens/:token', requireSuperAdmin, (req, res) => {
  const { token } = req.params;

  // Check current state
  const existing = db.prepare(
    'SELECT used_at FROM invite_tokens WHERE token = ? AND revoked_at IS NULL'
  ).get(token) as { used_at: number | null } | undefined;

  if (!existing) {
    return res.status(404).json({ error: 'token_not_found_or_already_revoked' });
  }

  db.prepare(
    "UPDATE invite_tokens SET revoked_at = strftime('%s','now') WHERE token = ? AND revoked_at IS NULL"
  ).run(token);

  res.json({ ok: true, was_used: existing.used_at !== null });
});

// GET /admin/sessions - List currently watching users
router.get('/admin/sessions', requireSuperAdmin, (_req, res) => {
  const rows = db.prepare(`
    SELECT p.user_id, u.email,
           p.tmdb_id, p.media_type, p.season, p.episode,
           p.position, p.duration, p.title, p.poster, p.updated_at
    FROM progress p
    JOIN users u ON u.id = p.user_id
    WHERE p.updated_at > strftime('%s','now') - 60
    ORDER BY p.updated_at DESC
  `).all() as AdminSession[];

  res.json({ sessions: rows });
});

export default router;
