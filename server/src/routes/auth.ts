import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { promisify } from 'node:util';
import rateLimit from 'express-rate-limit';
import { sql } from 'kysely';
import { kdb, withTx } from '../db';
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

    const result = await withTx(async (trx) => {
      if (!isSuperAdmin) {
        const inviteRow = await trx
          .selectFrom('invite_tokens')
          .select(['token', 'used_at', 'revoked_at'])
          .where('token', '=', token)
          .executeTakeFirst();

        if (!inviteRow) return { error: 'invalid_token' as const };
        if (inviteRow.revoked_at !== null) return { error: 'revoked_token' as const };
        if (inviteRow.used_at !== null) return { error: 'token_already_used' as const };
      }

      const inserted = await trx
        .insertInto('users')
        .values({ email: normalized, password_hash: hash })
        .returning('id')
        .executeTakeFirstOrThrow();

      if (!isSuperAdmin) {
        await trx
          .updateTable('invite_tokens')
          .set({
            used_at: sql<number>`EXTRACT(EPOCH FROM NOW())::BIGINT`,
            used_by_user_id: inserted.id
          })
          .where('token', '=', token)
          .execute();
      }

      return { userId: inserted.id };
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
  const row = await kdb
    .selectFrom('users')
    .select(['id', 'email', 'password_hash', 'autoplay_next', 'folders_enabled'])
    .where('email', '=', normalized)
    .executeTakeFirst();
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
  const row = await kdb
    .selectFrom('users')
    .select(['autoplay_next', 'folders_enabled'])
    .where('id', '=', req.user!.id)
    .executeTakeFirst();
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

router.get('/auth/check', requireAuth, (_req, res) => {
  res.status(200).end();
});

export default router;
