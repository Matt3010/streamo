import { Router } from 'express';
import { query } from '../db';
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

  await query(`
    INSERT INTO progress (user_id, tmdb_id, media_type, season, episode, position, duration, synthetic, title, poster, backdrop, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8, $9, $10, EXTRACT(EPOCH FROM NOW())::BIGINT)
    ON CONFLICT (user_id, tmdb_id, media_type, season, episode) DO UPDATE SET
      position = EXCLUDED.position,
      duration = EXCLUDED.duration,
      synthetic = 0,
      title = COALESCE(EXCLUDED.title, progress.title),
      poster = COALESCE(EXCLUDED.poster, progress.poster),
      backdrop = COALESCE(EXCLUDED.backdrop, progress.backdrop),
      updated_at = EXTRACT(EPOCH FROM NOW())::BIGINT
  `, [req.user!.id, tmdb_id, media_type, season, episode, position, duration,
      body.title || null, body.poster || null, body.backdrop || null]);

  await query(`
    DELETE FROM hidden_continue
    WHERE user_id = $1 AND tmdb_id = $2 AND media_type = $3
  `, [req.user!.id, tmdb_id, media_type]);

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
  const wlRes = await query<{ status: string }>(`
    SELECT status FROM watchlist
    WHERE user_id = $1 AND tmdb_id = $2 AND media_type = $3
  `, [userId, tmdbId, mediaType]);
  const wl = wlRes.rows[0];
  if (!wl) return false;

  if (wl.status === 'todo') {
    const result = await query(`
      UPDATE watchlist SET status = 'in_progress'
      WHERE user_id = $1 AND tmdb_id = $2 AND media_type = $3
    `, [userId, tmdbId, mediaType]);
    return result.rowCount > 0;
  }

  if (wl.status === 'done') return false;

  if (mediaType === 'movie') {
    const rowRes = await query<{ position: number; duration: number }>(`
      SELECT position, duration FROM progress
      WHERE user_id = $1 AND tmdb_id = $2 AND media_type = 'movie' AND season = 0 AND episode = 0 AND synthetic = 0
    `, [userId, tmdbId]);
    const row = rowRes.rows[0];
    if (row && row.duration > 0 && row.position >= row.duration * WATCHED_THRESHOLD) {
      const result = await query(`
        UPDATE watchlist SET status = 'done', done_aired_episodes = 0
        WHERE user_id = $1 AND tmdb_id = $2 AND media_type = 'movie'
      `, [userId, tmdbId]);
      return result.rowCount > 0;
    }
    return false;
  }

  const summary = await getTmdbTvSummary(tmdbId);
  const airedEp = getAiredEpisodesCount(summary);
  if (!airedEp) return false;

  const cntRes = await query<{ watched: number | null }>(`
    SELECT SUM(CASE WHEN duration > 0 AND position >= duration * ${WATCHED_THRESHOLD} THEN 1 ELSE 0 END)::INTEGER AS watched
    FROM progress
    WHERE user_id = $1 AND tmdb_id = $2 AND media_type = 'tv' AND synthetic = 0
  `, [userId, tmdbId]);
  const cnt = cntRes.rows[0];

  const latestRes = await query<{ season: number; episode: number; position: number; duration: number }>(`
    SELECT season, episode, position, duration FROM progress
    WHERE user_id = $1 AND tmdb_id = $2 AND media_type = 'tv' AND synthetic = 0
    ORDER BY updated_at DESC, season DESC, episode DESC
    LIMIT 1
  `, [userId, tmdbId]);
  const latest = latestRes.rows[0];
  const noLaterAiredEpisode = latest
    ? (await findNextEpisode(tmdbId, latest.season, latest.episode)) === null
    : false;
  const caughtUp = !!latest
    && latest.duration > 0
    && latest.position >= latest.duration * WATCHED_THRESHOLD
    && noLaterAiredEpisode;

  if ((cnt?.watched ?? 0) >= airedEp || caughtUp) {
    const result = await query(`
      UPDATE watchlist SET status = 'done', done_aired_episodes = $1
      WHERE user_id = $2 AND tmdb_id = $3 AND media_type = 'tv'
    `, [airedEp, userId, tmdbId]);
    return result.rowCount > 0;
  }
  return false;
}

router.get('/user/progress', requireAuth, async (req, res) => {
  const r = await query<ProgressRow>(`
    SELECT tmdb_id, media_type, season, episode, position, duration,
           title, poster, backdrop, updated_at
    FROM (
      SELECT p.*, ROW_NUMBER() OVER (
        PARTITION BY p.tmdb_id, p.media_type
        ORDER BY p.updated_at DESC, p.season DESC, p.episode DESC
      ) AS rn
      FROM progress p
      WHERE p.user_id = $1
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
    ) ranked WHERE rn = 1
    ORDER BY updated_at DESC
    LIMIT 30
  `, [req.user!.id]);
  const rows = r.rows;

  const items = await Promise.all(rows.map(async (row) => {
    if (row.media_type === 'movie') {
      const movieNearEnd = row.duration > 0 && row.position >= row.duration * CONTINUE_HIDE_THRESHOLD;
      return movieNearEnd ? null : row;
    }
    const ended = row.duration > 0 && row.position >= row.duration;
    if (!ended) return row;

    const next = await findNextEpisode(row.tmdb_id, row.season, row.episode);
    if (!next) return null;
    return { ...row, season: next.season, episode: next.episode, position: 0, duration: 0 };
  }));

  res.json({ items: items.filter((x): x is ProgressRow => x !== null) });
});

router.get('/user/progress/next/:type/:tmdb_id', requireAuth, async (req, res) => {
  const tmdb_id = toInt(req.params.tmdb_id, { min: 1 });
  const type = req.params.type;
  if (!tmdb_id || type !== 'tv') return res.status(400).json({ error: 'invalid_params' });
  res.json({ next: await resolveNextPlayable(req.user!.id, tmdb_id) });
});

router.get('/user/progress/series/:tmdb_id', requireAuth, async (req, res) => {
  const tmdb_id = toInt(req.params.tmdb_id, { min: 1 });
  if (!tmdb_id) return res.status(400).json({ error: 'invalid_params' });

  const r = await query(`
    SELECT season, episode, position, duration FROM progress
    WHERE user_id = $1 AND tmdb_id = $2 AND media_type = 'tv' AND synthetic = 0
  `, [req.user!.id, tmdb_id]);
  res.json({ items: r.rows });
});

router.delete('/user/progress/title/:type/:tmdb_id', requireAuth, async (req, res) => {
  const tmdb_id = toInt(req.params.tmdb_id, { min: 1 });
  const type = req.params.type;
  if (!tmdb_id || !['movie', 'tv'].includes(type)) return res.status(400).json({ error: 'invalid_params' });

  await query(`
    INSERT INTO hidden_continue (user_id, tmdb_id, media_type, hidden_at)
    VALUES ($1, $2, $3, EXTRACT(EPOCH FROM NOW())::BIGINT)
    ON CONFLICT (user_id, tmdb_id, media_type) DO UPDATE SET
      hidden_at = EXTRACT(EPOCH FROM NOW())::BIGINT
  `, [req.user!.id, tmdb_id, type]);

  notifyAdminSessionsChanged();
  res.json({ ok: true });
});

router.get('/user/progress/:type/:tmdb_id/:season?/:episode?', requireAuth, async (req, res) => {
  const tmdb_id = toInt(req.params.tmdb_id, { min: 1 });
  const season = toInt(req.params.season ?? 0, { min: 0 }) ?? 0;
  const episode = toInt(req.params.episode ?? 0, { min: 0 }) ?? 0;
  const type = req.params.type;
  if (!tmdb_id || !['movie', 'tv'].includes(type)) return res.status(400).json({ error: 'invalid_params' });

  const r = await query(`
    SELECT position, duration FROM progress
    WHERE user_id = $1 AND tmdb_id = $2 AND media_type = $3 AND season = $4 AND episode = $5 AND synthetic = 0
  `, [req.user!.id, tmdb_id, type, season, episode]);
  res.json({ progress: r.rows[0] || null });
});

router.delete('/user/progress/:type/:tmdb_id/:season?/:episode?', requireAuth, async (req, res) => {
  const tmdb_id = toInt(req.params.tmdb_id, { min: 1 });
  const season = toInt(req.params.season ?? 0, { min: 0 }) ?? 0;
  const episode = toInt(req.params.episode ?? 0, { min: 0 }) ?? 0;
  const type = req.params.type;
  if (!tmdb_id || !['movie', 'tv'].includes(type)) return res.status(400).json({ error: 'invalid_params' });

  await query(`
    DELETE FROM progress WHERE user_id = $1 AND tmdb_id = $2 AND media_type = $3 AND season = $4 AND episode = $5
  `, [req.user!.id, tmdb_id, type, season, episode]);
  notifyAdminSessionsChanged();
  res.json({ ok: true });
});

export default router;
