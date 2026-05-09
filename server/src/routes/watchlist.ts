import { Router } from 'express';
import { db } from '../db';
import { requireAuth } from '../middleware/auth';
import { toInt } from '../utils/validation';
import { CONTINUE_HIDE_THRESHOLD, WATCHED_THRESHOLD } from '../config';
import { getTmdbTvSummary } from '../services/tmdb-cache';
import { resolveNextPlayable } from '../services/next-episode';
import type { WatchlistItem } from '../../../shared/types';

const router = Router();

interface WatchlistRow {
  tmdb_id: number;
  media_type: 'movie' | 'tv';
  title: string | null;
  poster: string | null;
  status: 'todo' | 'done';
  done_aired_episodes: number;
  added_at: number;
}

interface ProgressAggregate {
  last_season: number;
  last_episode: number;
  watched_count: number;
}

function getAiredEpisodesCount(summary: Awaited<ReturnType<typeof getTmdbTvSummary>>): number {
  if (!summary) return 0;
  const lea = summary.last_episode_to_air;
  return lea
    ? summary.seasons
        .filter(s => s.season_number < lea.season_number)
        .reduce((sum, s) => sum + (s.episode_count || 0), 0) + lea.episode_number
    : (summary.number_of_episodes ?? 0);
}

router.post('/user/watchlist', requireAuth, (req, res) => {
  const body = req.body || {};
  const tmdb_id = toInt(body.tmdb_id, { min: 1 });
  const media_type = body.media_type;
  if (!tmdb_id || !media_type) return res.status(400).json({ error: 'missing_fields' });
  if (!['movie', 'tv'].includes(media_type)) return res.status(400).json({ error: 'invalid_type' });
  db.prepare(`
    INSERT OR IGNORE INTO watchlist (user_id, tmdb_id, media_type, title, poster)
    VALUES (?, ?, ?, ?, ?)
  `).run(req.user!.id, tmdb_id, media_type, body.title || null, body.poster || null);
  res.json({ ok: true });
});

router.get('/user/watchlist', requireAuth, async (req, res) => {
  const rows = db.prepare(`
    SELECT tmdb_id, media_type, title, poster, status, done_aired_episodes, added_at
    FROM watchlist WHERE user_id = ?
    ORDER BY added_at DESC
  `).all(req.user!.id) as WatchlistRow[];

  // Latest in-flight progress row per item: drives the percentage bar.
  const latestProgress = new Map<string, { position: number; duration: number }>();
  if (rows.length > 0) {
    const latestRows = db.prepare(`
      SELECT tmdb_id, media_type, position, duration FROM (
        SELECT tmdb_id, media_type, position, duration, updated_at,
               ROW_NUMBER() OVER (PARTITION BY tmdb_id, media_type ORDER BY updated_at DESC) AS rn
        FROM progress
        WHERE user_id = ?
          AND synthetic = 0
      )
      WHERE rn = 1
        AND duration > 0
        AND position > 5
        AND position < duration * ${CONTINUE_HIDE_THRESHOLD}
    `).all(req.user!.id) as Array<{ tmdb_id: number; media_type: string; position: number; duration: number }>;
    for (const p of latestRows) {
      latestProgress.set(`${p.media_type}:${p.tmdb_id}`, { position: p.position, duration: p.duration });
    }
  }

  // Per-show progress aggregate for TV items: latest real season/episode touched
  // plus how many episodes actually crossed WATCHED_THRESHOLD.
  const tvIds = rows.filter(r => r.media_type === 'tv').map(r => r.tmdb_id);
  const progressByTmdb = new Map<number, ProgressAggregate>();
  if (tvIds.length > 0) {
    const placeholders = tvIds.map(() => '?').join(',');
    const seasons = db.prepare(`
      SELECT tmdb_id,
        MAX(season) AS max_season,
        SUM(CASE WHEN duration > 0 AND position >= duration * ${WATCHED_THRESHOLD} THEN 1 ELSE 0 END) AS watched_count
      FROM progress
      WHERE user_id = ? AND media_type = 'tv' AND synthetic = 0 AND tmdb_id IN (${placeholders})
      GROUP BY tmdb_id
    `).all(req.user!.id, ...tvIds) as Array<{ tmdb_id: number; max_season: number; watched_count: number }>;
    for (const s of seasons) {
      const ep = db.prepare(`
        SELECT MAX(episode) AS max_episode FROM progress
        WHERE user_id = ? AND media_type = 'tv' AND synthetic = 0 AND tmdb_id = ? AND season = ?
      `).get(req.user!.id, s.tmdb_id, s.max_season) as { max_episode: number | null } | undefined;
      progressByTmdb.set(s.tmdb_id, {
        last_season: s.max_season,
        last_episode: ep?.max_episode ?? 0,
        watched_count: s.watched_count
      });
    }
  }

  const items: WatchlistItem[] = await Promise.all(rows.map(async (r) => {
    const inFlight = latestProgress.get(`${r.media_type}:${r.tmdb_id}`);
    if (r.media_type !== 'tv') {
      return inFlight ? { ...r, position: inFlight.position, duration: inFlight.duration } : r;
    }

    const prog = progressByTmdb.get(r.tmdb_id) ?? { last_season: 0, last_episode: 0, watched_count: 0 };
    const tmdb = await getTmdbTvSummary(r.tmdb_id);
    const totalEpisodes = tmdb?.number_of_episodes ?? 0;
    const airedEpisodes = getAiredEpisodesCount(tmdb);
    let status = r.status;
    let doneAiredEpisodes = r.done_aired_episodes ?? 0;

    // Legacy/manual done rows created before done_aired_episodes existed should
    // be pinned to "caught up as of now" once, so future releases can flip them.
    if (status === 'done' && doneAiredEpisodes === 0 && airedEpisodes > 0) {
      db.prepare(`
        UPDATE watchlist SET done_aired_episodes = ?
        WHERE user_id = ? AND tmdb_id = ? AND media_type = 'tv'
      `).run(airedEpisodes, req.user!.id, r.tmdb_id);
      doneAiredEpisodes = airedEpisodes;
    }

    // New aired episodes since the user manually marked "Visto": flip back to
    // todo, but keep the baseline so the badge can say how many are newly missing.
    if (status === 'done' && doneAiredEpisodes > 0 && airedEpisodes > doneAiredEpisodes) {
      db.prepare(`
        UPDATE watchlist SET status = 'todo'
        WHERE user_id = ? AND tmdb_id = ? AND media_type = 'tv'
      `).run(req.user!.id, r.tmdb_id);
      status = 'todo';
    }

    const next = await resolveNextPlayable(req.user!.id, r.tmdb_id);
    return {
      ...r,
      status,
      done_aired_episodes: doneAiredEpisodes,
      last_season: prog.last_season,
      last_episode: prog.last_episode,
      watched_count: prog.watched_count,
      total_seasons: tmdb?.number_of_seasons ?? 0,
      total_episodes: totalEpisodes,
      aired_episodes: airedEpisodes,
      seasons: tmdb?.seasons ?? [],
      next_season: next?.season,
      next_episode: next?.episode,
      ...(inFlight ? { position: inFlight.position, duration: inFlight.duration } : {})
    };
  }));

  res.json({ items });
});

router.patch('/user/watchlist/:type/:tmdb_id', requireAuth, async (req, res) => {
  const tmdb_id = toInt(req.params.tmdb_id, { min: 1 });
  const type = req.params.type;
  const status = (req.body || {}).status;
  if (!tmdb_id || !['movie', 'tv'].includes(type)) return res.status(400).json({ error: 'invalid_params' });
  if (!['todo', 'done'].includes(status)) return res.status(400).json({ error: 'invalid_status' });

  let doneAiredEpisodes = 0;
  if (type === 'tv' && status === 'done') {
    const summary = await getTmdbTvSummary(tmdb_id);
    doneAiredEpisodes = getAiredEpisodesCount(summary);
  }

  const result = db.prepare(`
    UPDATE watchlist SET status = ?, done_aired_episodes = ?
    WHERE user_id = ? AND tmdb_id = ? AND media_type = ?
  `).run(status, doneAiredEpisodes, req.user!.id, tmdb_id, type);
  if (result.changes === 0) return res.status(404).json({ error: 'not_found' });

  res.json({ ok: true });
});

router.delete('/user/watchlist/:type/:tmdb_id', requireAuth, (req, res) => {
  const tmdb_id = toInt(req.params.tmdb_id, { min: 1 });
  const type = req.params.type;
  if (!tmdb_id || !['movie', 'tv'].includes(type)) return res.status(400).json({ error: 'invalid_params' });
  // Watchlist and progress are independent: removing a title from the list
  // must not erase the user's viewing position. Cleanup of progress is
  // handled separately via the history endpoints.
  db.prepare(`DELETE FROM watchlist WHERE user_id = ? AND tmdb_id = ? AND media_type = ?`).run(req.user!.id, tmdb_id, type);
  res.json({ ok: true });
});

router.get('/user/watchlist/check/:type/:tmdb_id', requireAuth, (req, res) => {
  const tmdb_id = toInt(req.params.tmdb_id, { min: 1 });
  const type = req.params.type;
  if (!tmdb_id || !['movie', 'tv'].includes(type)) return res.status(400).json({ error: 'invalid_params' });
  const row = db.prepare(`
    SELECT 1 as in_list FROM watchlist
    WHERE user_id = ? AND tmdb_id = ? AND media_type = ?
  `).get(req.user!.id, tmdb_id, type);
  res.json({ in_list: !!row });
});

export default router;
