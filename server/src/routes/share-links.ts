import { Router } from 'express';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { query } from '../db';
import { authenticateToken, requireAuth } from '../middleware/auth';
import { publishShareLinkRevoked } from '../services/user-live';
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
  const r = await query<ShareLink>(`
    SELECT id, token, label, status, view_count, created_at
    FROM share_links
    WHERE user_id = $1
    ORDER BY created_at DESC
  `, [req.user!.id]);

  res.json({ links: r.rows });
});

router.post('/user/share-links', requireAuth, async (req, res) => {
  const body = req.body || {};
  const label = normalizeLabel(body.label);
  const token = crypto.randomBytes(18).toString('base64url');

  await query(`
    INSERT INTO share_links (token, user_id, label, status)
    VALUES ($1, $2, $3, 'active')
  `, [token, req.user!.id, label]);

  const r = await query<ShareLink>(`
    SELECT id, token, label, status, view_count, created_at
    FROM share_links
    WHERE token = $1
  `, [token]);

  res.json(r.rows[0]);
});

router.patch('/user/share-links/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: 'invalid_id' });
  }

  const body = req.body || {};
  const updates: string[] = [];
  const params: Array<string | number> = [];
  let idx = 1;

  if (body.status !== undefined) {
    const status = body.status as ShareLinkStatus;
    if (status !== 'active' && status !== 'suspended') {
      return res.status(400).json({ error: 'invalid_status' });
    }
    updates.push(`status = $${idx++}`);
    params.push(status);
  }

  if (body.label !== undefined) {
    updates.push(`label = $${idx++}`);
    params.push(normalizeLabel(body.label) ?? '');
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'no_changes' });
  }

  params.push(id, req.user!.id);
  const result = await query(`
    UPDATE share_links
    SET ${updates.join(', ')}
    WHERE id = $${idx} AND user_id = $${idx + 1}
  `, params);

  if (result.rowCount === 0) {
    return res.status(404).json({ error: 'not_found' });
  }

  const r = await query<ShareLink>(`
    SELECT id, token, label, status, view_count, created_at
    FROM share_links
    WHERE id = $1 AND user_id = $2
  `, [id, req.user!.id]);
  const row = r.rows[0];

  if (row.status === 'suspended') {
    publishShareLinkRevoked(row.token);
  }

  res.json(row);
});

router.delete('/user/share-links/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: 'invalid_id' });
  }

  const existingRes = await query<{ token: string }>(`
    SELECT token FROM share_links WHERE id = $1 AND user_id = $2
  `, [id, req.user!.id]);
  const existing = existingRes.rows[0];

  const result = await query(`
    DELETE FROM share_links WHERE id = $1 AND user_id = $2
  `, [id, req.user!.id]);

  if (result.rowCount === 0) {
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

  const linkRes = await query<{ user_id: number; status: string; email: string }>(`
    SELECT s.user_id, s.status, u.email
    FROM share_links s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = $1
  `, [token]);
  const link = linkRes.rows[0];

  if (!link || link.status !== 'active') {
    return res.status(404).json({ error: 'not_found' });
  }

  const shouldTrack = req.query.track === '1';
  if (shouldTrack) {
    const viewer = (await authenticateToken(req.cookies?.token)).user;
    if (!viewer || viewer.id !== link.user_id) {
      await query('UPDATE share_links SET view_count = view_count + 1 WHERE token = $1', [token]);
    }
  }

  const itemsRes = await query<SharedWatchlistItem>(`
    SELECT tmdb_id, media_type, title, poster, status, folder_name,
           done_aired_episodes, added_at
    FROM watchlist
    WHERE user_id = $1
    ORDER BY added_at DESC
  `, [link.user_id]);

  const response: SharedWatchlistResponse = {
    owner: { name: link.email.split('@')[0] },
    items: itemsRes.rows
  };

  res.json(response);
});

export default router;
