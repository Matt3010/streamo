import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { promisify } from 'node:util';
import rateLimit from 'express-rate-limit';
import { db } from '../db';
import { EMAIL_RE } from '../config';
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

router.post('/auth/register', authLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'missing_fields' });
  if (email.length > 254 || !EMAIL_RE.test(email)) return res.status(400).json({ error: 'invalid_email' });
  if (password.length < 6) return res.status(400).json({ error: 'weak_password' });

  const normalized = (email as string).trim().toLowerCase();
  try {
    const hash = await bcryptHash(password, 10);
    const info = db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run(normalized, hash);
    const user: User = { id: Number(info.lastInsertRowid), email: normalized, autoplay_next: 1 };
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
  const user: User = { id: row.id, email: row.email, autoplay_next: row.autoplay_next };
  setAuthCookie(res, user);
  res.json({ user });
});

router.post('/auth/logout', (_req, res) => {
  res.clearCookie('token', { path: '/' });
  res.json({ ok: true });
});

router.get('/auth/me', requireAuth, (req, res) => {
  const row = db.prepare('SELECT autoplay_next FROM users WHERE id = ?').get(req.user!.id) as { autoplay_next: 0 | 1 } | undefined;
  const user: User = { id: req.user!.id, email: req.user!.email, autoplay_next: row ? row.autoplay_next : 1 };
  res.json({ user });
});

export default router;
