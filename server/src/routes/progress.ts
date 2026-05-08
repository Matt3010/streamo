import { Router } from 'express';
import { db } from '../db';
import { requireAuth } from '../middleware/auth';
import { toInt } from '../utils/validation';
import { CONTINUE_HIDE_THRESHOLD, WATCHED_THRESHOLD } from '../config';
import { getTmdbTvSummary } from '../services/tmdb-cache';
import { findNextEpisode, resolveNextPlayable } from '../services/next-episode';
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
    INSERT INTO progress (user_id, tmdb_id, media_type, season, episode, position, duration, title, poster, backdrop, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%s','now'))
    ON CONFLICT(user_id, tmdb_id, media_type, season, episode) DO UPDATE SET
      position = excluded.position,
      duration = excluded.duration,
      title = COALESCE(excluded.title, title),
      poster = COALESCE(excluded.poster, poster),
      backdrop = COALESCE(excluded.backdrop, backdrop),
      updated_at = strftime('%s','now')
  `).run(req.user!.id, tmdb_id, media_type, season, episode, position, duration,
         body.title || null, body.poster || null, body.backdrop || null);

  // Auto-flip watchlist status to 'done' when the user has effectively
  // finished the title via real playback. Only flips upward (todo → done).
  await maybeAutoCompleteWatchlist(req.user!.id, tmdb_id, media_type);

  res.json({ ok: true });
});

async function maybeAutoCompleteWatchlist(userId: number, tmdbId: number, mediaType: string): Promise<void> {
  const wl = db.prepare(`
    SELECT status FROM watchlist
    WHERE user_id = ? AND tmdb_id = ? AND media_type = ?
  `).get(userId, tmdbId, mediaType) as { status: string } | undefined;
  if (!wl || wl.status === 'done') return;

  if (mediaType === 'movie') {
    const row = db.prepare(`
      SELECT position, duration FROM progress
      WHERE user_id = ? AND tmdb_id = ? AND media_type = 'movie' AND season = 0 AND episode = 0
    `).get(userId, tmdbId) as { position: number; duration: number } | undefined;
    if (row && row.duration > 0 && row.position >= row.duration * WATCHED_THRESHOLD) {
      db.prepare(`UPDATE watchlist SET status = 'done' WHERE user_id = ? AND tmdb_id = ? AND media_type = 'movie'`)
        .run(userId, tmdbId);
    }
    return;
  }

  // TV: need TMDB total_episodes to decide.
  const summary = await getTmdbTvSummary(tmdbId);
  const totalEp = summary?.number_of_episodes ?? 0;
  if (!totalEp) return;
  const cnt = db.prepare(`
    SELECT SUM(CASE WHEN duration > 0 AND position >= duration * ${WATCHED_THRESHOLD} THEN 1 ELSE 0 END) AS watched
    FROM progress
    WHERE user_id = ? AND tmdb_id = ? AND media_type = 'tv'
  `).get(userId, tmdbId) as { watched: number | null } | undefined;
  if ((cnt?.watched ?? 0) >= totalEp) {
    db.prepare(`UPDATE watchlist SET status = 'done' WHERE user_id = ? AND tmdb_id = ? AND media_type = 'tv'`)
      .run(userId, tmdbId);
  }
}

router.get('/user/progress', requireAuth, async (req, res) => {
  // Latest progress row per show (deterministic via ROW_NUMBER — when several
  // rows share updated_at, e.g. after a manual "mark up to S2E5", we pick the
  // furthest-along episode). The ≥95% filter is NOT applied here so we can
  // pivot a finished episode to "next episode, position 0" below.
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
        AND p.position > 5
        AND NOT EXISTS (
          SELECT 1 FROM watchlist w
          WHERE w.user_id = p.user_id
            AND w.tmdb_id = p.tmdb_id
            AND w.media_type = p.media_type
            AND w.status = 'done'
        )
    ) WHERE rn = 1
    ORDER BY updated_at DESC
    LIMIT 30
  `).all(req.user!.id) as ProgressRow[];

  // Pivot to the next episode only when the user *actually* finished one —
  // i.e. the iframe fired 'ended' and the handler saved position = duration.
  // The CONTINUE_HIDE_THRESHOLD (95%) is too eager: at 97% the user might
  // still want to scrub the last 90 seconds, so pivoting hides their real
  // progress. 'ended' is the only signal that semantically means "done".
  // Movies still drop out at the hide threshold (no next-episode pivot).
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

// "Where to play next" — most recently touched episode, pivoted to the
// following one if it's been fully watched. Mirrors the Continue watching
// pivot in GET /user/progress so the dropdowns on the watch page land on
// the same episode no matter where the user clicked through from.
router.get('/user/progress/next/:type/:tmdb_id', requireAuth, async (req, res) => {
  const tmdb_id = toInt(req.params.tmdb_id, { min: 1 });
  const type = req.params.type;
  if (!tmdb_id || type !== 'tv') return res.status(400).json({ error: 'invalid_params' });
  res.json({ next: await resolveNextPlayable(req.user!.id, tmdb_id) });
});

// All per-episode progress for a single TV series. Used by the watch page
// to render progress bars on every episode card in one round-trip rather
// than firing N separate /user/progress/tv/:id/:s/:e fetches as the user
// scrolls. Must come BEFORE the generic /:type/:tmdb_id route below or
// 'series' would be matched as a media_type.
router.get('/user/progress/series/:tmdb_id', requireAuth, (req, res) => {
  const tmdb_id = toInt(req.params.tmdb_id, { min: 1 });
  if (!tmdb_id) return res.status(400).json({ error: 'invalid_params' });

  const items = db.prepare(`
    SELECT season, episode, position, duration FROM progress
    WHERE user_id = ? AND tmdb_id = ? AND media_type = 'tv'
  `).all(req.user!.id, tmdb_id);
  res.json({ items });
});

router.get('/user/progress/:type/:tmdb_id/:season?/:episode?', requireAuth, (req, res) => {
  const tmdb_id = toInt(req.params.tmdb_id, { min: 1 });
  const season = toInt(req.params.season ?? 0, { min: 0 }) ?? 0;
  const episode = toInt(req.params.episode ?? 0, { min: 0 }) ?? 0;
  const type = req.params.type;
  if (!tmdb_id || !['movie', 'tv'].includes(type)) return res.status(400).json({ error: 'invalid_params' });

  const row = db.prepare(`
    SELECT position, duration FROM progress
    WHERE user_id = ? AND tmdb_id = ? AND media_type = ? AND season = ? AND episode = ?
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
  res.json({ ok: true });
});

export default router;
