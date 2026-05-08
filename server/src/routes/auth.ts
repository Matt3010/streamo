import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { promisify } from 'node:util';
import rateLimit from 'express-rate-limit';
import { db } from '../db';
import { EMAIL_RE, SUPER_ADMIN_EMAIL } from '../config';
import { requireAuth, setAuthCookie } from '../middleware/auth';
import type { User } from '../../../shared/types';

const router = Router();

const bcryptHash = promisify<string, number, string>(bcrypt.hash as never);
const bcryptCompare = promisify<string, string, boolean>(bcrypt.compare as never);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_attempts' }
});

interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  autoplay_next: 0 | 1;
}

interface InviteTokenRow {
  token: string;
  used_at: number | null;
  revoked_at: number | null;
}

router.post('/auth/register', authLimiter, async (req, res) => {
  const { email, password, token } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'missing_fields' });
  if (email.length > 254 || !EMAIL_RE.test(email)) return res.status(400).json({ error: 'invalid_email' });
  if (password.length < 6) return res.status(400).json({ error: 'weak_password' });

  const normalized = (email as string).trim().toLowerCase();
  const isSuperAdmin = SUPER_ADMIN_EMAIL && normalized === SUPER_ADMIN_EMAIL;

  // Super admin doesn't need a token; others do
  if (!isSuperAdmin) {
    if (!SUPER_ADMIN_EMAIL) {
      return res.status(400).json({ error: 'super_admin_not_configured' });
    }
    if (!token) {
      return res.status(400).json({ error: 'missing_token' });
    }
  }

  try {
    const hash = await bcryptHash(password, 10);

    // Use a transaction for atomicity
    const result = db.transaction(() => {
      // Validate invite token if not super admin
      if (!isSuperAdmin) {
        const inviteRow = db.prepare(
          'SELECT token, used_at, revoked_at FROM invite_tokens WHERE token = ?'
        ).get(token) as InviteTokenRow | undefined;

        if (!inviteRow) {
          return { error: 'invalid_token' };
        }
        if (inviteRow.revoked_at !== null) {
          return { error: 'revoked_token' };
        }
        if (inviteRow.used_at !== null) {
          return { error: 'token_already_used' };
        }
      }

      // Insert user
      const info = db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run(normalized, hash);
      const userId = Number(info.lastInsertRowid);

      // Mark token as used (if not super admin)
      if (!isSuperAdmin) {
        db.prepare(
          "UPDATE invite_tokens SET used_at = strftime('%s','now'), used_by_user_id = ? WHERE token = ?"
        ).run(userId, token);
      }

      return { userId };
    })();

    if ('error' in result) {
      return res.status(400).json({ error: result.error });
    }

    const user: User = { id: result.userId, email: normalized, autoplay_next: 1, is_admin: isSuperAdmin };
    setAuthCookie(res, user);
    res.json({ user });
  } catch (e) {
    if (String((e as Error).message).includes('UNIQUE')) return res.status(409).json({ error: 'email_taken' });
    res.status(500).json({ error: 'server_error' });
  }
});

router.post('/auth/login', authLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'missing_fields' });

  const normalized = (email as string).trim().toLowerCase();
  const row = db.prepare('SELECT id, email, password_hash, autoplay_next FROM users WHERE email = ?').get(normalized) as UserRow | undefined;
  if (!row || !(await bcryptCompare(password, row.password_hash))) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }
  const isAdmin = SUPER_ADMIN_EMAIL && row.email.toLowerCase() === SUPER_ADMIN_EMAIL;
  const user: User = { id: row.id, email: row.email, autoplay_next: row.autoplay_next, is_admin: isAdmin };
  setAuthCookie(res, user);
  res.json({ user });
});

router.post('/auth/logout', (_req, res) => {
  res.clearCookie('token', { path: '/' });
  res.json({ ok: true });
});

router.get('/auth/me', requireAuth, (req, res) => {
  const row = db.prepare('SELECT autoplay_next FROM users WHERE id = ?').get(req.user!.id) as { autoplay_next: 0 | 1 } | undefined;
  const isAdmin = SUPER_ADMIN_EMAIL && req.user!.email.toLowerCase() === SUPER_ADMIN_EMAIL;
  const user: User = { id: req.user!.id, email: req.user!.email, autoplay_next: row ? row.autoplay_next : 1, is_admin: isAdmin };
  res.json({ user });
});

// Lightweight session check used by nginx `auth_request` to gate the
// playback routes (/player, /embed). Just verifies the JWT cookie — no
// DB query, no body — so gating doesn't add latency to every iframe load.
// 200 = authenticated, 401 = not. Anything else nginx treats as 500.
router.get('/auth/check', requireAuth, (_req, res) => {
  res.status(200).end();
});

export default router;
