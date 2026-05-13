import { Router } from 'express';
import { db } from '../db';
import { requireAuth } from '../middleware/auth';
import { toInt } from '../utils/validation';
import { CONTINUE_HIDE_THRESHOLD, WATCHED_THRESHOLD } from '../config';
import { getAiredEpisodesCount, getTmdbTvSummary } from '../services/tmdb-cache';
import { findNextEpisode, resolveNextPlayable } from '../services/next-episode';
import { notifyAdminSessionsChanged } from '../services/admin-live';
import { publishUserWatchlistChanged } from '../services/user-live';
import type { MediaType } from '../../../shared/types';

const router = Router();

interface ProgressRow {
  tmdb_id: number;
  media_type: MediaType;
  season: number;
  episode: number;
  position: number;
  duration: number;
  title: string | null;
  poster: string | null;
  backdrop: string | null;
  updated_at: number;
}

router.post('/user/progress', requireAuth, async (req, res) => {
  const body = req.body || {};
  const tmdb_id = toInt(body.tmdb_id, { min: 1 });
  const media_type = body.media_type;
  const season = toInt(body.season ?? 0, { min: 0 }) ?? 0;
  const episode = toInt(body.episode ?? 0, { min: 0 }) ?? 0;
  const position = Number(body.position);
  const durationRaw = Number(body.duration ?? 0);
  const duration = Number.isFinite(durationRaw) ? durationRaw : 0;

  if (!tmdb_id || !media_type || !Number.isFinite(position)) return res.status(400).json({ error: 'missing_fields' });
  if (!['movie', 'tv'].includes(media_type)) return res.status(400).json({ error: 'invalid_type' });

  db.prepare(`
    INSERT INTO progress (user_id, tmdb_id, media_type, season, episode, position, duration, synthetic, title, poster, backdrop, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, strftime('%s','now'))
    ON CONFLICT(user_id, tmdb_id, media_type, season, episode) DO UPDATE SET
      position = excluded.position,
      duration = excluded.duration,
      synthetic = 0,
      title = COALESCE(excluded.title, title),
      poster = COALESCE(excluded.poster, poster),
      backdrop = COALESCE(excluded.backdrop, backdrop),
      updated_at = strftime('%s','now')
  `).run(req.user!.id, tmdb_id, media_type, season, episode, position, duration,
         body.title || null, body.poster || null, body.backdrop || null);

  db.prepare(`
    DELETE FROM hidden_continue
    WHERE user_id = ? AND tmdb_id = ? AND media_type = ?
  `).run(req.user!.id, tmdb_id, media_type);

  const watchlistChanged = await maybeAutoCompleteWatchlist(req.user!.id, tmdb_id, media_type);
  if (watchlistChanged) {
    publishUserWatchlistChanged(req.user!.id, {
      reason: 'watchlist-changed',
      tmdb_id,
      media_type
    });
  }
  notifyAdminSessionsChanged();

  res.json({ ok: true });
});

async function maybeAutoCompleteWatchlist(userId: number, tmdbId: number, mediaType: string): Promise<boolean> {
  const wl = db.prepare(`
    SELECT status FROM watchlist
    WHERE user_id = ? AND tmdb_id = ? AND media_type = ?
  `).get(userId, tmdbId, mediaType) as { status: string } | undefined;
  if (!wl || wl.status === 'done') return false;

  if (mediaType === 'movie') {
    const row = db.prepare(`
      SELECT position, duration FROM progress
      WHERE user_id = ? AND tmdb_id = ? AND media_type = 'movie' AND season = 0 AND episode = 0 AND synthetic = 0
    `).get(userId, tmdbId) as { position: number; duration: number } | undefined;
    if (row && row.duration > 0 && row.position >= row.duration * WATCHED_THRESHOLD) {
      const result = db.prepare(`
        UPDATE watchlist SET status = 'done', done_aired_episodes = 0
        WHERE user_id = ? AND tmdb_id = ? AND media_type = 'movie'
      `).run(userId, tmdbId);
      return result.changes > 0;
    }
    return false;
  }

  const summary = await getTmdbTvSummary(tmdbId);
  const airedEp = getAiredEpisodesCount(summary);
  if (!airedEp) return false;

  const cnt = db.prepare(`
    SELECT SUM(CASE WHEN duration > 0 AND position >= duration * ${WATCHED_THRESHOLD} THEN 1 ELSE 0 END) AS watched
    FROM progress
    WHERE user_id = ? AND tmdb_id = ? AND media_type = 'tv' AND synthetic = 0
  `).get(userId, tmdbId) as { watched: number | null } | undefined;

  const latest = db.prepare(`
    SELECT season, episode, position, duration FROM progress
    WHERE user_id = ? AND tmdb_id = ? AND media_type = 'tv' AND synthetic = 0
    ORDER BY updated_at DESC, season DESC, episode DESC
    LIMIT 1
  `).get(userId, tmdbId) as { season: number; episode: number; position: number; duration: number } | undefined;
  const noLaterAiredEpisode = latest
    ? (await findNextEpisode(tmdbId, latest.season, latest.episode)) === null
    : false;
  const caughtUp = !!latest
    && latest.duration > 0
    && latest.position >= latest.duration * WATCHED_THRESHOLD
    && noLaterAiredEpisode;

  if ((cnt?.watched ?? 0) >= airedEp || caughtUp) {
    const result = db.prepare(`
      UPDATE watchlist SET status = 'done', done_aired_episodes = ?
      WHERE user_id = ? AND tmdb_id = ? AND media_type = 'tv'
    `).run(airedEp, userId, tmdbId);
    return result.changes > 0;
  }
  return false;
}

router.get('/user/progress', requireAuth, async (req, res) => {
  const rows = db.prepare(`
    SELECT tmdb_id, media_type, season, episode, position, duration,
           title, poster, backdrop, updated_at
    FROM (
      SELECT p.*, ROW_NUMBER() OVER (
        PARTITION BY p.tmdb_id, p.media_type
        ORDER BY p.updated_at DESC, p.season DESC, p.episode DESC
      ) AS rn
      FROM progress p
      WHERE p.user_id = ?
        AND p.synthetic = 0
        AND p.position > 5
        AND NOT EXISTS (
          SELECT 1 FROM watchlist w
          WHERE w.user_id = p.user_id
            AND w.tmdb_id = p.tmdb_id
            AND w.media_type = p.media_type
            AND w.status = 'done'
        )
        AND NOT EXISTS (
          SELECT 1 FROM hidden_continue hc
          WHERE hc.user_id = p.user_id
            AND hc.tmdb_id = p.tmdb_id
            AND hc.media_type = p.media_type
        )
    ) WHERE rn = 1
    ORDER BY updated_at DESC
    LIMIT 30
  `).all(req.user!.id) as ProgressRow[];

  const items = await Promise.all(rows.map(async (r) => {
    if (r.media_type === 'movie') {
      const movieNearEnd = r.duration > 0 && r.position >= r.duration * CONTINUE_HIDE_THRESHOLD;
      return movieNearEnd ? null : r;
    }
    const ended = r.duration > 0 && r.position >= r.duration;
    if (!ended) return r;

    const next = await findNextEpisode(r.tmdb_id, r.season, r.episode);
    if (!next) return null;
    return { ...r, season: next.season, episode: next.episode, position: 0, duration: 0 };
  }));

  res.json({ items: items.filter((x): x is ProgressRow => x !== null) });
});

router.get('/user/progress/next/:type/:tmdb_id', requireAuth, async (req, res) => {
  const tmdb_id = toInt(req.params.tmdb_id, { min: 1 });
  const type = req.params.type;
  if (!tmdb_id || type !== 'tv') return res.status(400).json({ error: 'invalid_params' });
  res.json({ next: await resolveNextPlayable(req.user!.id, tmdb_id) });
});

router.get('/user/progress/series/:tmdb_id', requireAuth, (req, res) => {
  const tmdb_id = toInt(req.params.tmdb_id, { min: 1 });
  if (!tmdb_id) return res.status(400).json({ error: 'invalid_params' });

  const items = db.prepare(`
    SELECT season, episode, position, duration FROM progress
    WHERE user_id = ? AND tmdb_id = ? AND media_type = 'tv' AND synthetic = 0
  `).all(req.user!.id, tmdb_id);
  res.json({ items });
});

router.delete('/user/progress/title/:type/:tmdb_id', requireAuth, (req, res) => {
  const tmdb_id = toInt(req.params.tmdb_id, { min: 1 });
  const type = req.params.type;
  if (!tmdb_id || !['movie', 'tv'].includes(type)) return res.status(400).json({ error: 'invalid_params' });

  db.prepare(`
    INSERT INTO hidden_continue (user_id, tmdb_id, media_type, hidden_at)
    VALUES (?, ?, ?, strftime('%s','now'))
    ON CONFLICT(user_id, tmdb_id, media_type) DO UPDATE SET
      hidden_at = strftime('%s','now')
  `).run(req.user!.id, tmdb_id, type);

  notifyAdminSessionsChanged();
  res.json({ ok: true });
});

router.get('/user/progress/:type/:tmdb_id/:season?/:episode?', requireAuth, (req, res) => {
  const tmdb_id = toInt(req.params.tmdb_id, { min: 1 });
  const season = toInt(req.params.season ?? 0, { min: 0 }) ?? 0;
  const episode = toInt(req.params.episode ?? 0, { min: 0 }) ?? 0;
  const type = req.params.type;
  if (!tmdb_id || !['movie', 'tv'].includes(type)) return res.status(400).json({ error: 'invalid_params' });

  const row = db.prepare(`
    SELECT position, duration FROM progress
    WHERE user_id = ? AND tmdb_id = ? AND media_type = ? AND season = ? AND episode = ? AND synthetic = 0
  `).get(req.user!.id, tmdb_id, type, season, episode);
  res.json({ progress: row || null });
});

router.delete('/user/progress/:type/:tmdb_id/:season?/:episode?', requireAuth, (req, res) => {
  const tmdb_id = toInt(req.params.tmdb_id, { min: 1 });
  const season = toInt(req.params.season ?? 0, { min: 0 }) ?? 0;
  const episode = toInt(req.params.episode ?? 0, { min: 0 }) ?? 0;
  const type = req.params.type;
  if (!tmdb_id || !['movie', 'tv'].includes(type)) return res.status(400).json({ error: 'invalid_params' });

  db.prepare(`
    DELETE FROM progress WHERE user_id = ? AND tmdb_id = ? AND media_type = ? AND season = ? AND episode = ?
  `).run(req.user!.id, tmdb_id, type, season, episode);
  notifyAdminSessionsChanged();
  res.json({ ok: true });
});

export default router;
