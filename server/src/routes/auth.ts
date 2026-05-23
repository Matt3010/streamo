import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { promisify } from 'node:util';
import rateLimit from 'express-rate-limit';
import { kdb } from '../db';
import { SUPER_ADMIN_EMAIL } from '../config';
import { authenticateToken, requireAuth, respondAuthFailure, setAuthCookie } from '../middleware/auth';
import { hasValidVixcloudSignature } from '../utils/vix-token';
import type { User } from '../../../shared/types';

const router = Router();

const bcryptCompare = promisify<string, string, boolean>(bcrypt.compare as never);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_attempts' }
});

router.post('/auth/login', authLimiter, async (req, res) => {
  const body = req.body ?? {};
  const email = typeof body.email === 'string' ? body.email : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!email || !password) return res.status(400).json({ error: 'missing_fields' });

  const normalized = email.trim().toLowerCase();
  const row = await kdb
    .selectFrom('users')
    .select([
      'id', 'email', 'password_hash',
      'autoplay_next', 'folders_enabled',
      'notif_new_episode', 'notif_new_season', 'notif_resume_reminder',
      'background_pattern_data_url'
    ])
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
    notif_new_episode: row.notif_new_episode,
    notif_new_season: row.notif_new_season,
    notif_resume_reminder: row.notif_resume_reminder,
    background_pattern_data_url: row.background_pattern_data_url,
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
    .select([
      'autoplay_next', 'folders_enabled',
      'notif_new_episode', 'notif_new_season', 'notif_resume_reminder',
      'background_pattern_data_url'
    ])
    .where('id', '=', req.user!.id)
    .executeTakeFirst();
  const isAdmin = Boolean(SUPER_ADMIN_EMAIL) && req.user!.email.toLowerCase() === SUPER_ADMIN_EMAIL;
  const user: User = {
    id: req.user!.id,
    email: req.user!.email,
    autoplay_next: row?.autoplay_next ?? 1,
    folders_enabled: row?.folders_enabled ?? 1,
    notif_new_episode: row?.notif_new_episode ?? 1,
    notif_new_season: row?.notif_new_season ?? 1,
    notif_resume_reminder: row?.notif_resume_reminder ?? 1,
    background_pattern_data_url: row?.background_pattern_data_url ?? null,
    is_admin: isAdmin
  };
  res.json({ user });
});

router.get('/auth/check', async (req, res) => {
  // Cookie path: standard browser session.
  const cookieResult = await authenticateToken(req.cookies?.token);
  if (cookieResult.user) {
    res.status(200).end();
    return;
  }

  // Bypass for short-lived vixcloud-signed URLs (AirPlay/Cast). nginx
  // forwards the parent request URI via X-Original-Uri so we can read
  // `token=&expires=` here even though the subrequest itself is `/auth/check`.
  const originalUri = req.headers['x-original-uri'];
  if (typeof originalUri === 'string' && hasValidVixcloudSignature(originalUri)) {
    res.status(200).end();
    return;
  }

  respondAuthFailure(req, res, cookieResult.error ?? 'unauthenticated');
});

export default router;
