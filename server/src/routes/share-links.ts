import { Router } from 'express';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { sql } from 'kysely';
import { kdb } from '../db';
import { authenticateToken, requireAuth } from '../middleware/auth';
import { publishShareLinkRevoked } from '../services/user-live';
import { toInt } from '../utils/validation';
import type {
  ShareLink,
  ShareLinkStatus,
  SharedWatchlistItem,
  SharedWatchlistResponse
} from '../../../shared/types';

const router = Router();

const MAX_LABEL_LENGTH = 60;

const sharedLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_requests' }
});

function normalizeLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_LABEL_LENGTH);
}

router.get('/user/share-links', requireAuth, async (req, res) => {
  const links = await kdb
    .selectFrom('share_links')
    .select(['id', 'token', 'label', 'status', 'view_count', 'created_at'])
    .where('user_id', '=', req.user!.id)
    .orderBy('created_at', 'desc')
    .execute() as ShareLink[];

  res.json({ links });
});

router.post('/user/share-links', requireAuth, async (req, res) => {
  const body = req.body || {};
  const label = normalizeLabel(body.label);
  const token = crypto.randomBytes(18).toString('base64url');

  await kdb
    .insertInto('share_links')
    .values({ token, user_id: req.user!.id, label, status: 'active' })
    .execute();

  const row = await kdb
    .selectFrom('share_links')
    .select(['id', 'token', 'label', 'status', 'view_count', 'created_at'])
    .where('token', '=', token)
    .executeTakeFirstOrThrow();

  res.json(row);
});

router.patch('/user/share-links/:id', requireAuth, async (req, res) => {
  const id = toInt(req.params.id, { min: 1 });
  if (!id) {
    return res.status(400).json({ error: 'invalid_id' });
  }

  const body = req.body || {};
  const updates: { status?: ShareLinkStatus; label?: string } = {};

  if (body.status !== undefined) {
    const status = body.status as ShareLinkStatus;
    if (status !== 'active' && status !== 'suspended') {
      return res.status(400).json({ error: 'invalid_status' });
    }
    updates.status = status;
  }

  if (body.label !== undefined) {
    updates.label = normalizeLabel(body.label) ?? '';
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'no_changes' });
  }

  const result = await kdb
    .updateTable('share_links')
    .set(updates)
    .where('id', '=', id)
    .where('user_id', '=', req.user!.id)
    .executeTakeFirst();

  if (Number(result.numUpdatedRows) === 0) {
    return res.status(404).json({ error: 'not_found' });
  }

  const row = await kdb
    .selectFrom('share_links')
    .select(['id', 'token', 'label', 'status', 'view_count', 'created_at'])
    .where('id', '=', id)
    .where('user_id', '=', req.user!.id)
    .executeTakeFirstOrThrow();

  if (row.status === 'suspended') {
    publishShareLinkRevoked(row.token);
  }

  res.json(row);
});

router.delete('/user/share-links/:id', requireAuth, async (req, res) => {
  const id = toInt(req.params.id, { min: 1 });
  if (!id) {
    return res.status(400).json({ error: 'invalid_id' });
  }

  const existing = await kdb
    .selectFrom('share_links')
    .select('token')
    .where('id', '=', id)
    .where('user_id', '=', req.user!.id)
    .executeTakeFirst();

  const result = await kdb
    .deleteFrom('share_links')
    .where('id', '=', id)
    .where('user_id', '=', req.user!.id)
    .executeTakeFirst();

  if (Number(result.numDeletedRows) === 0) {
    return res.status(404).json({ error: 'not_found' });
  }

  if (existing) publishShareLinkRevoked(existing.token);

  res.json({ ok: true });
});

router.get('/shared/:token', sharedLimiter, async (req, res) => {
  const { token } = req.params;
  if (!token || typeof token !== 'string') {
    return res.status(404).json({ error: 'not_found' });
  }

  const link = await kdb
    .selectFrom('share_links as s')
    .innerJoin('users as u', 'u.id', 's.user_id')
    .select(['s.user_id', 's.status', 'u.email'])
    .where('s.token', '=', token)
    .executeTakeFirst();

  if (!link || link.status !== 'active') {
    return res.status(404).json({ error: 'not_found' });
  }

  const shouldTrack = req.query.track === '1';
  if (shouldTrack) {
    const viewer = (await authenticateToken(req.cookies?.token)).user;
    if (!viewer || viewer.id !== link.user_id) {
      // Re-check status atomically: if an admin suspended the link
      // between the SELECT above and this UPDATE, we don't want a
      // spurious view to land on a now-suspended share.
      await kdb
        .updateTable('share_links')
        .set({ view_count: sql<number>`view_count + 1` })
        .where('token', '=', token)
        .where('status', '=', 'active')
        .execute();
    }
  }

  const items = await kdb
    .selectFrom('watchlist')
    .select([
      'tmdb_id', 'media_type', 'title', 'poster', 'status',
      'folder_name', 'done_aired_episodes', 'added_at'
    ])
    .where('user_id', '=', link.user_id)
    .orderBy('added_at', 'desc')
    .execute() as SharedWatchlistItem[];

  const response: SharedWatchlistResponse = {
    owner: { name: link.email.split('@')[0] },
    items
  };

  res.json(response);
});

export default router;
