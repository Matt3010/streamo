import { Router } from 'express';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { db } from '../db';
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

/* Per-IP throttle for the public /shared/:token endpoint. 60 req/min
 * is generous for a human browsing their friend's list (page open,
 * occasional refresh) but stops trivial enumeration of the token
 * space. The auth-required CRUD endpoints don't need this — they're
 * already gated by session. */
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

/* GET /user/share-links — list the share links the caller owns. */
router.get('/user/share-links', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT id, token, label, status, view_count, created_at
    FROM share_links
    WHERE user_id = ?
    ORDER BY created_at DESC
  `).all(req.user!.id) as ShareLink[];

  res.json({ links: rows });
});

/* POST /user/share-links — create a new share link for the caller. */
router.post('/user/share-links', requireAuth, (req, res) => {
  const body = req.body || {};
  const label = normalizeLabel(body.label);
  const token = crypto.randomBytes(18).toString('base64url');

  db.prepare(`
    INSERT INTO share_links (token, user_id, label, status)
    VALUES (?, ?, ?, 'active')
  `).run(token, req.user!.id, label);

  const row = db.prepare(`
    SELECT id, token, label, status, view_count, created_at
    FROM share_links
    WHERE token = ?
  `).get(token) as ShareLink;

  res.json(row);
});

/* PATCH /user/share-links/:id — toggle status (suspend / resume). The
 * caller can also update the label here in one round-trip. */
router.patch('/user/share-links/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: 'invalid_id' });
  }

  const body = req.body || {};
  const updates: string[] = [];
  const params: Array<string | number> = [];

  if (body.status !== undefined) {
    const status = body.status as ShareLinkStatus;
    if (status !== 'active' && status !== 'suspended') {
      return res.status(400).json({ error: 'invalid_status' });
    }
    updates.push('status = ?');
    params.push(status);
  }

  if (body.label !== undefined) {
    updates.push('label = ?');
    params.push(normalizeLabel(body.label) ?? '');
    /* SQLite stores '' for the empty label rather than NULL — keeps
     * the column non-null for clients that prefer no nullable check.
     * Read paths treat empty and null equivalently. */
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'no_changes' });
  }

  params.push(id, req.user!.id);
  const result = db.prepare(`
    UPDATE share_links
    SET ${updates.join(', ')}
    WHERE id = ? AND user_id = ?
  `).run(...params);

  if (result.changes === 0) {
    return res.status(404).json({ error: 'not_found' });
  }

  const row = db.prepare(`
    SELECT id, token, label, status, view_count, created_at
    FROM share_links
    WHERE id = ? AND user_id = ?
  `).get(id, req.user!.id) as ShareLink;

  if (row.status === 'suspended') {
    publishShareLinkRevoked(row.token);
  }

  res.json(row);
});

/* DELETE /user/share-links/:id — permanently remove a share link.
 * Anyone holding that URL gets a 404 from the public endpoint
 * afterwards. */
router.delete('/user/share-links/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: 'invalid_id' });
  }

  const existing = db.prepare(`
    SELECT token FROM share_links WHERE id = ? AND user_id = ?
  `).get(id, req.user!.id) as { token: string } | undefined;

  const result = db.prepare(`
    DELETE FROM share_links WHERE id = ? AND user_id = ?
  `).run(id, req.user!.id);

  if (result.changes === 0) {
    return res.status(404).json({ error: 'not_found' });
  }

  if (existing) publishShareLinkRevoked(existing.token);

  res.json({ ok: true });
});

/* GET /shared/:token — public read-only view of the owner's
 * watchlist. Returns 404 if the token is unknown OR the link is
 * suspended — the recipient cannot tell the two apart, which is
 * exactly the requested UX. */
router.get('/shared/:token', sharedLimiter, (req, res) => {
  const { token } = req.params;
  if (!token || typeof token !== 'string') {
    return res.status(404).json({ error: 'not_found' });
  }

  const link = db.prepare(`
    SELECT s.user_id, s.status, u.email
    FROM share_links s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ?
  `).get(token) as { user_id: number; status: string; email: string } | undefined;

  if (!link || link.status !== 'active') {
    return res.status(404).json({ error: 'not_found' });
  }

  /* Count this open if:
   *   - the caller explicitly asked to (?track=1 — the initial page
   *     load, not the WS-triggered refetches that would inflate it);
   *   - the caller is not the owner of the link (an owner opening
   *     their own link should not pollute their own metric).
   * Unauthenticated visitors always count when track=1; authenticated
   * non-owner visitors also count. */
  const shouldTrack = req.query.track === '1';
  if (shouldTrack) {
    const viewer = authenticateToken(req.cookies?.token).user;
    if (!viewer || viewer.id !== link.user_id) {
      db.prepare('UPDATE share_links SET view_count = view_count + 1 WHERE token = ?').run(token);
    }
  }

  const items = db.prepare(`
    SELECT tmdb_id, media_type, title, poster, status, folder_name,
           done_aired_episodes, added_at
    FROM watchlist
    WHERE user_id = ?
    ORDER BY added_at DESC
  `).all(link.user_id) as SharedWatchlistItem[];

  /* Only the local-part of the email is exposed (before the @) so
   * the recipient sees a username-like handle rather than the
   * owner's full address. */
  const response: SharedWatchlistResponse = {
    owner: { name: link.email.split('@')[0] },
    items
  };

  res.json(response);
});

export default router;
