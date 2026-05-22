import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { sql } from 'kysely';
import { kdb } from '../db';
import { FCM_MAX_TOKENS_PER_USER } from '../config';
import { requireAuth } from '../middleware/auth';
import { redactToken } from '../services/fcm';

const router = Router();

// Rate limited by authenticated user (not IP) — bots can't register
// without a valid JWT cookie anyway, and a single user behind a CGNAT
// should still get sensible quota independent of their neighbours.
const fcmRegisterLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => req.user ? `user:${req.user.id}` : `ip:${req.ip ?? '-'}`,
  message: { error: 'too_many_attempts' }
});

const MIN_TOKEN_LEN = 40;
const MAX_TOKEN_LEN = 4096;
const MAX_USER_AGENT_LEN = 512;

function readToken(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const raw = (body as { token?: unknown }).token;
  if (typeof raw !== 'string') return null;
  const token = raw.trim();
  if (token.length < MIN_TOKEN_LEN || token.length > MAX_TOKEN_LEN) return null;
  // FCM tokens are URL-safe base64 + a few separators; reject anything else
  // so we don't ship surprising payloads into the SDK.
  if (!/^[A-Za-z0-9_:\-.~]+$/.test(token)) return null;
  return token;
}

function readUserAgent(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const raw = (body as { user_agent?: unknown }).user_agent;
  if (typeof raw !== 'string') return null;
  return raw.slice(0, MAX_USER_AGENT_LEN);
}

router.post('/user/fcm/register', requireAuth, fcmRegisterLimiter, async (req, res) => {
  const token = readToken(req.body);
  if (!token) return res.status(400).json({ error: 'invalid_token' });

  const userAgent = readUserAgent(req.body);
  const userId = req.user!.id;

  await kdb
    .insertInto('fcm_tokens')
    .values({
      token,
      user_id: userId,
      user_agent: userAgent,
      last_seen_at: sql<number>`EXTRACT(EPOCH FROM NOW())::BIGINT`
    })
    .onConflict((oc) => oc.column('token').doUpdateSet({
      user_id: userId,
      user_agent: userAgent,
      last_seen_at: sql<number>`EXTRACT(EPOCH FROM NOW())::BIGINT`
    }))
    .execute();

  // Evict the oldest tokens beyond the per-user cap. Done after the upsert
  // so the token the caller just registered is always retained — even when
  // they were already at the cap with N stale tokens.
  await sql`
    DELETE FROM fcm_tokens
    WHERE user_id = ${userId}
      AND token NOT IN (
        SELECT token FROM fcm_tokens
        WHERE user_id = ${userId}
        ORDER BY last_seen_at DESC
        LIMIT ${FCM_MAX_TOKENS_PER_USER}
      )
  `.execute(kdb);

  console.log(`[fcm] register user=${userId} token=${redactToken(token)}`);
  res.json({ ok: true });
});

router.post('/user/fcm/unregister', requireAuth, async (req, res) => {
  const token = readToken(req.body);
  if (!token) return res.status(400).json({ error: 'invalid_token' });

  await kdb
    .deleteFrom('fcm_tokens')
    .where('user_id', '=', req.user!.id)
    .where('token', '=', token)
    .execute();

  console.log(`[fcm] unregister user=${req.user!.id} token=${redactToken(token)}`);
  res.json({ ok: true });
});

export default router;
