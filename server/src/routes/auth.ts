import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { promisify } from 'node:util';
import rateLimit from 'express-rate-limit';
import { query, withTx, clientQuery } from '../db';
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
  folders_enabled: 0 | 1;
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
  const isSuperAdmin = Boolean(SUPER_ADMIN_EMAIL) && normalized === SUPER_ADMIN_EMAIL;

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

    const result = await withTx(async (client) => {
      if (!isSuperAdmin) {
        const inviteRes = await clientQuery<InviteTokenRow>(
          client,
          'SELECT token, used_at, revoked_at FROM invite_tokens WHERE token = $1',
          [token]
        );
        const inviteRow = inviteRes.rows[0];

        if (!inviteRow) return { error: 'invalid_token' as const };
        if (inviteRow.revoked_at !== null) return { error: 'revoked_token' as const };
        if (inviteRow.used_at !== null) return { error: 'token_already_used' as const };
      }

      const userRes = await clientQuery<{ id: number }>(
        client,
        'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id',
        [normalized, hash]
      );
      const userId = userRes.rows[0].id;

      if (!isSuperAdmin) {
        await clientQuery(
          client,
          "UPDATE invite_tokens SET used_at = EXTRACT(EPOCH FROM NOW())::BIGINT, used_by_user_id = $1 WHERE token = $2",
          [userId, token]
        );
      }

      return { userId };
    });

    if ('error' in result) {
      return res.status(400).json({ error: result.error });
    }

    const user: User = {
      id: result.userId,
      email: normalized,
      autoplay_next: 1,
      folders_enabled: 1,
      is_admin: isSuperAdmin
    };
    setAuthCookie(res, user);
    res.json({ user });
  } catch (e) {
    const msg = String((e as Error).message);
    if (msg.includes('duplicate key') || msg.includes('users_email_key')) {
      return res.status(409).json({ error: 'email_taken' });
    }
    console.error('[auth/register]', e);
    res.status(500).json({ error: 'server_error' });
  }
});

router.post('/auth/login', authLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'missing_fields' });

  const normalized = (email as string).trim().toLowerCase();
  const userRes = await query<UserRow>(
    'SELECT id, email, password_hash, autoplay_next, folders_enabled FROM users WHERE email = $1',
    [normalized]
  );
  const row = userRes.rows[0];
  if (!row || !(await bcryptCompare(password, row.password_hash))) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }
  const isAdmin = Boolean(SUPER_ADMIN_EMAIL) && row.email.toLowerCase() === SUPER_ADMIN_EMAIL;
  const user: User = {
    id: row.id,
    email: row.email,
    autoplay_next: row.autoplay_next,
    folders_enabled: row.folders_enabled,
    is_admin: isAdmin
  };
  setAuthCookie(res, user);
  res.json({ user });
});

router.post('/auth/logout', (_req, res) => {
  res.clearCookie('token', { path: '/' });
  res.json({ ok: true });
});

router.get('/auth/me', requireAuth, async (req, res) => {
  const r = await query<{ autoplay_next: 0 | 1; folders_enabled: 0 | 1 }>(
    'SELECT autoplay_next, folders_enabled FROM users WHERE id = $1',
    [req.user!.id]
  );
  const row = r.rows[0];
  const isAdmin = Boolean(SUPER_ADMIN_EMAIL) && req.user!.email.toLowerCase() === SUPER_ADMIN_EMAIL;
  const user: User = {
    id: req.user!.id,
    email: req.user!.email,
    autoplay_next: row?.autoplay_next ?? 1,
    folders_enabled: row?.folders_enabled ?? 1,
    is_admin: isAdmin
  };
  res.json({ user });
});

// Lightweight session check used by nginx `auth_request` to gate the
// playback routes (/player, /embed). Just verifies the JWT cookie + the
// invite-token revocation state via requireAuth.
router.get('/auth/check', requireAuth, (_req, res) => {
  res.status(200).end();
});

export default router;
