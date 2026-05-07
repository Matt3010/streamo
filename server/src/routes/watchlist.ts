import { Router } from 'express';
import { db } from '../db';
import { requireAuth } from '../middleware/auth';
import { toInt } from '../utils/validation';
import { CONTINUE_HIDE_THRESHOLD, WATCHED_THRESHOLD } from '../config';
import { getTmdbTvSummary } from '../services/tmdb-cache';
import type { WatchlistItem } from '../../../shared/types';

const router = Router();

interface WatchlistRow {
  tmdb_id: number;
  media_type: 'movie' | 'tv';
  title: string | null;
  poster: string | null;
  status: 'todo' | 'done';
  added_at: number;
}

interface ProgressAggregate {
  last_season: number;
  last_episode: number;
  watched_count: number;
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
    SELECT tmdb_id, media_type, title, poster, status, added_at
    FROM watchlist WHERE user_id = ?
    ORDER BY added_at DESC
  `).all(req.user!.id) as WatchlistRow[];

  // Latest in-flight progress row per item — drives the percentage bar.
  const latestProgress = new Map<string, { position: number; duration: number }>();
  if (rows.length > 0) {
    const latestRows = db.prepare(`
      SELECT tmdb_id, media_type, position, duration FROM (
        SELECT tmdb_id, media_type, position, duration, updated_at,
               ROW_NUMBER() OVER (PARTITION BY tmdb_id, media_type ORDER BY updated_at DESC) AS rn
        FROM progress
        WHERE user_id = ?
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

  // Per-show progress aggregate for TV items: max season touched + watched_count.
  const tvIds = rows.filter(r => r.media_type === 'tv').map(r => r.tmdb_id);
  const progressByTmdb = new Map<number, ProgressAggregate>();
  if (tvIds.length > 0) {
    const placeholders = tvIds.map(() => '?').join(',');
    const seasons = db.prepare(`
      SELECT tmdb_id,
        MAX(season) AS max_season,
        SUM(CASE WHEN duration > 0 AND position >= duration * ${WATCHED_THRESHOLD} THEN 1 ELSE 0 END) AS watched_count
      FROM progress
      WHERE user_id = ? AND media_type = 'tv' AND tmdb_id IN (${placeholders})
      GROUP BY tmdb_id
    `).all(req.user!.id, ...tvIds) as Array<{ tmdb_id: number; max_season: number; watched_count: number }>;
    for (const s of seasons) {
      const ep = db.prepare(`
        SELECT MAX(episode) AS max_episode FROM progress
        WHERE user_id = ? AND media_type = 'tv' AND tmdb_id = ? AND season = ?
      `).get(req.user!.id, s.tmdb_id, s.max_season) as { max_episode: number | null } | undefined;
      progressByTmdb.set(s.tmdb_id, {
        last_season: s.max_season,
        last_episode: ep?.max_episode ?? 0,
        watched_count: s.watched_count
      });
    }
  }

  const items: WatchlistItem[] = await Promise.all(rows.map(async r => {
    const inFlight = latestProgress.get(`${r.media_type}:${r.tmdb_id}`);
    if (r.media_type !== 'tv') {
      return inFlight ? { ...r, position: inFlight.position, duration: inFlight.duration } : r;
    }
    const prog = progressByTmdb.get(r.tmdb_id) ?? { last_season: 0, last_episode: 0, watched_count: 0 };
    const tmdb = await getTmdbTvSummary(r.tmdb_id);
    const totalEpisodes = tmdb?.number_of_episodes ?? 0;
    let status = r.status;
    // Auto-flip done → todo when new episodes have been released since the
    // user last marked the show as caught up.
    if (status === 'done' && totalEpisodes > 0 && prog.watched_count < totalEpisodes) {
      db.prepare(`
        UPDATE watchlist SET status = 'todo'
        WHERE user_id = ? AND tmdb_id = ? AND media_type = 'tv'
      `).run(req.user!.id, r.tmdb_id);
      status = 'todo';
    }
    return {
      ...r,
      status,
      last_season: prog.last_season,
      last_episode: prog.last_episode,
      watched_count: prog.watched_count,
      total_seasons: tmdb?.number_of_seasons ?? 0,
      total_episodes: totalEpisodes,
      seasons: tmdb?.seasons ?? [],
      ...(inFlight ? { position: inFlight.position, duration: inFlight.duration } : {})
    };
  }));

  res.json({ items });
});

// Manual progress marking: insert/upsert progress rows up to (season, episode).
// With { all: true } also flips watchlist status to 'done'.
router.post('/user/watchlist/:type/:tmdb_id/mark', requireAuth, async (req, res) => {
  const tmdb_id = toInt(req.params.tmdb_id, { min: 1 });
  const type = req.params.type;
  const body = req.body || {};
  const all = body.all === true;
  if (!tmdb_id || type !== 'tv') return res.status(400).json({ error: 'invalid_params' });

  const summary = await getTmdbTvSummary(tmdb_id);
  if (!summary || !Array.isArray(summary.seasons) || summary.seasons.length === 0) {
    return res.status(503).json({ error: 'tmdb_unavailable' });
  }

  const finale = summary.seasons.reduce((a, b) => b.season_number > a.season_number ? b : a, summary.seasons[0]);
  let stopSeason = 0;
  let stopEpisode = 0;
  if (all) {
    stopSeason = finale.season_number;
    stopEpisode = finale.episode_count || 0;
    if (!stopEpisode) return res.status(503).json({ error: 'tmdb_unavailable' });
  } else {
    stopSeason = toInt(body.season, { min: 1 }) ?? 0;
    stopEpisode = toInt(body.episode, { min: 1 }) ?? 0;
    if (!stopSeason || !stopEpisode) return res.status(400).json({ error: 'invalid_params' });
    const targetSeason = summary.seasons.find(s => s.season_number === stopSeason);
    if (!targetSeason || stopEpisode > (targetSeason.episode_count || 0)) {
      return res.status(400).json({ error: 'invalid_season_or_episode' });
    }
  }
  // If the manual cutoff lands exactly on the finale, treat it the same as
  // "L'ho visto tutto" — status='done', skip the redundant DELETE.
  const reachedFinale = stopSeason === finale.season_number && stopEpisode === (finale.episode_count || 0);
  const finalStatus = (all || reachedFinale) ? 'done' : 'todo';

  const insert = db.prepare(`
    INSERT INTO progress (user_id, tmdb_id, media_type, season, episode, position, duration)
    VALUES (?, ?, 'tv', ?, ?, 1, 1)
    ON CONFLICT(user_id, tmdb_id, media_type, season, episode) DO UPDATE SET
      position = MAX(position, duration),
      duration = MAX(duration, 1)
  `);
  const tx = db.transaction(() => {
    if (!all && !reachedFinale) {
      db.prepare(`
        DELETE FROM progress
        WHERE user_id = ? AND tmdb_id = ? AND media_type = 'tv'
          AND (season > ? OR (season = ? AND episode > ?))
      `).run(req.user!.id, tmdb_id, stopSeason, stopSeason, stopEpisode);
    }
    for (const s of summary.seasons) {
      if (s.season_number > stopSeason) continue;
      const lastEp = s.season_number === stopSeason ? stopEpisode : (s.episode_count || 0);
      for (let ep = 1; ep <= lastEp; ep++) {
        insert.run(req.user!.id, tmdb_id, s.season_number, ep);
      }
    }
    db.prepare(`
      UPDATE watchlist SET status = ?
      WHERE user_id = ? AND tmdb_id = ? AND media_type = 'tv'
    `).run(finalStatus, req.user!.id, tmdb_id);
  });
  tx();
  res.json({ ok: true });
});

router.patch('/user/watchlist/:type/:tmdb_id', requireAuth, async (req, res) => {
  const tmdb_id = toInt(req.params.tmdb_id, { min: 1 });
  const type = req.params.type;
  const status = (req.body || {}).status;
  if (!tmdb_id || !['movie', 'tv'].includes(type)) return res.status(400).json({ error: 'invalid_params' });
  if (!['todo', 'done'].includes(status)) return res.status(400).json({ error: 'invalid_status' });
  const result = db.prepare(`
    UPDATE watchlist SET status = ?
    WHERE user_id = ? AND tmdb_id = ? AND media_type = ?
  `).run(status, req.user!.id, tmdb_id, type);
  if (result.changes === 0) return res.status(404).json({ error: 'not_found' });

  // Sync progress with the user's intent:
  //  - status='done' → mark every episode watched
  //  - status='todo' → wipe progress
  if (type === 'tv') {
    if (status === 'done') {
      const summary = await getTmdbTvSummary(tmdb_id);
      if (summary?.seasons?.length) {
        const insert = db.prepare(`
          INSERT INTO progress (user_id, tmdb_id, media_type, season, episode, position, duration)
          VALUES (?, ?, 'tv', ?, ?, 1, 1)
          ON CONFLICT(user_id, tmdb_id, media_type, season, episode) DO UPDATE SET
            position = MAX(position, duration),
            duration = MAX(duration, 1)
        `);
        const tx = db.transaction(() => {
          for (const s of summary.seasons) {
            for (let ep = 1; ep <= (s.episode_count || 0); ep++) {
              insert.run(req.user!.id, tmdb_id, s.season_number, ep);
            }
          }
        });
        tx();
      }
    } else {
      db.prepare(`
        DELETE FROM progress WHERE user_id = ? AND tmdb_id = ? AND media_type = 'tv'
      `).run(req.user!.id, tmdb_id);
    }
  }
  res.json({ ok: true });
});

router.delete('/user/watchlist/:type/:tmdb_id', requireAuth, (req, res) => {
  const tmdb_id = toInt(req.params.tmdb_id, { min: 1 });
  const type = req.params.type;
  if (!tmdb_id || !['movie', 'tv'].includes(type)) return res.status(400).json({ error: 'invalid_params' });
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM watchlist WHERE user_id = ? AND tmdb_id = ? AND media_type = ?`).run(req.user!.id, tmdb_id, type);
    db.prepare(`DELETE FROM progress WHERE user_id = ? AND tmdb_id = ? AND media_type = ?`).run(req.user!.id, tmdb_id, type);
  });
  tx();
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
