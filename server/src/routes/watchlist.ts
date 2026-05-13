import { Router } from 'express';
import { db } from '../db';
import { requireAuth } from '../middleware/auth';
import { toInt } from '../utils/validation';
import { CONTINUE_HIDE_THRESHOLD, WATCHED_THRESHOLD } from '../config';
import { getAiredEpisodesCount, getBaseAiredEpisodesCount, getTmdbTvSummary, type TmdbTvSummary } from '../services/tmdb-cache';
import { formatNewEpisodesMessage, formatNextEpisodeDate } from '../../../shared/release-format';
import { findNextEpisode, resolveNextPlayable } from '../services/next-episode';
import { publishUserWatchlistChanged } from '../services/user-live';
import { enqueueWatchlistTitleRefresh } from '../services/watchlist-jobs';
import type { WatchlistItem } from '../../../shared/types';

const router = Router();

interface WatchlistRow {
  tmdb_id: number;
  media_type: 'movie' | 'tv';
  title: string | null;
  poster: string | null;
  status: 'todo' | 'in_progress' | 'done';
  folder_name: string | null;
  done_aired_episodes: number;
  added_at: number;
}

interface ProgressAggregate {
  last_season: number;
  last_episode: number;
  watched_count: number;
}

interface LatestTvProgressRow {
  season: number;
  episode: number;
  position: number;
  duration: number;
}

function normalizeFolderName(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;

  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (!trimmed) return null;
  if (trimmed.length > 60) return undefined;
  return trimmed;
}

function formatMovieRemaining(position: number | undefined, duration: number | undefined): string | undefined {
  const pos = position ?? 0;
  const dur = duration ?? 0;
  if (dur <= 0 || pos <= 0 || pos >= dur) return undefined;

  const remainingMinutes = Math.ceil((dur - pos) / 60);
  if (remainingMinutes <= 0) return undefined;
  if (remainingMinutes < 60) {
    return remainingMinutes === 1 ? 'Manca 1 min' : `Mancano ${remainingMinutes} min`;
  }

  const hours = Math.floor(remainingMinutes / 60);
  const minutes = remainingMinutes % 60;
  const timeLeft = minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
  return hours === 1 && minutes === 0 ? `Manca ${timeLeft}` : `Mancano ${timeLeft}`;
}

function formatTvStatusText(
  tmdb: TmdbTvSummary | null,
  watchedCount: number,
  doneAiredEpisodes: number,
  caughtUp: boolean
): string | undefined {
  const airedEpisodes = getAiredEpisodesCount(tmdb);
  const baseAiredEpisodes = getBaseAiredEpisodesCount(tmdb);

  if (airedEpisodes <= 0) return undefined;

  // Check for new episodes (next_episode_to_air has aired today)
  const newEpisodes = Math.max(0, airedEpisodes - baseAiredEpisodes);
  if (newEpisodes > 0) return formatNewEpisodesMessage(newEpisodes);

  if (caughtUp) return 'Sei al passo';

  const watchedBaseline = Math.max(watchedCount, doneAiredEpisodes);
  if (watchedBaseline <= 0) return undefined;

  const remaining = Math.max(0, airedEpisodes - watchedBaseline);
  if (remaining === 0) return 'Sei al passo';
  return remaining === 1 ? 'Manca 1 episodio' : `Mancano ${remaining} episodi`;
}

function formatNextReleaseText(tmdb: TmdbTvSummary | null): string | undefined {
  return formatNextEpisodeDate(tmdb?.next_episode_to_air?.air_date);
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
  publishUserWatchlistChanged(req.user!.id, {
    reason: 'watchlist-changed',
    tmdb_id,
    media_type
  });
  if (media_type === 'tv') {
    void enqueueWatchlistTitleRefresh(tmdb_id, 'watchlist-add');
  }
  res.json({ ok: true });
});

router.get('/user/watchlist', requireAuth, async (req, res) => {
  const statusFilter = typeof req.query.status === 'string' ? req.query.status : '';
  const mediaFilter = typeof req.query.media_type === 'string' ? req.query.media_type : '';
  if (statusFilter && !['todo', 'in_progress', 'done'].includes(statusFilter)) {
    return res.status(400).json({ error: 'invalid_status' });
  }
  if (mediaFilter && !['movie', 'tv'].includes(mediaFilter)) {
    return res.status(400).json({ error: 'invalid_type' });
  }

  const where = ['user_id = ?'];
  const params: Array<number | string> = [req.user!.id];
  if (mediaFilter) {
    where.push('media_type = ?');
    params.push(mediaFilter);
  }

  const rows = db.prepare(`
    SELECT tmdb_id, media_type, title, poster, status, folder_name, done_aired_episodes, added_at
    FROM watchlist
    WHERE ${where.join(' AND ')}
    ORDER BY added_at DESC
  `).all(...params) as WatchlistRow[];

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

  const tvIds = rows.filter(r => r.media_type === 'tv').map(r => r.tmdb_id);
  const progressByTmdb = new Map<number, ProgressAggregate>();
  const latestTvProgressByTmdb = new Map<number, LatestTvProgressRow>();
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

    const latestRows = db.prepare(`
      SELECT tmdb_id, season, episode, position, duration FROM (
        SELECT tmdb_id, season, episode, position, duration, updated_at,
               ROW_NUMBER() OVER (PARTITION BY tmdb_id ORDER BY updated_at DESC, season DESC, episode DESC) AS rn
        FROM progress
        WHERE user_id = ? AND media_type = 'tv' AND synthetic = 0 AND tmdb_id IN (${placeholders})
      )
      WHERE rn = 1
    `).all(req.user!.id, ...tvIds) as Array<{ tmdb_id: number; season: number; episode: number; position: number; duration: number }>;
    for (const row of latestRows) {
      latestTvProgressByTmdb.set(row.tmdb_id, {
        season: row.season,
        episode: row.episode,
        position: row.position,
        duration: row.duration
      });
    }
  }

  const allItems: WatchlistItem[] = await Promise.all(rows.map(async (r) => {
    const inFlight = latestProgress.get(`${r.media_type}:${r.tmdb_id}`);
    if (r.media_type !== 'tv') {
      return {
        ...r,
        watch_status_text: formatMovieRemaining(inFlight?.position, inFlight?.duration),
        ...(inFlight ? { position: inFlight.position, duration: inFlight.duration } : {})
      };
    }

    const prog = progressByTmdb.get(r.tmdb_id) ?? { last_season: 0, last_episode: 0, watched_count: 0 };
    const latestTv = latestTvProgressByTmdb.get(r.tmdb_id);
    const tmdb = await getTmdbTvSummary(r.tmdb_id);
    const totalEpisodes = tmdb?.number_of_episodes ?? 0;
    const airedEpisodes = getAiredEpisodesCount(tmdb);
    const resume = await resolveNextPlayable(req.user!.id, r.tmdb_id);

    let status = r.status;
    let doneAiredEpisodes = r.done_aired_episodes ?? 0;

    if (status === 'done' && doneAiredEpisodes === 0 && airedEpisodes > 0) {
      db.prepare(`
        UPDATE watchlist SET done_aired_episodes = ?
        WHERE user_id = ? AND tmdb_id = ? AND media_type = 'tv'
      `).run(airedEpisodes, req.user!.id, r.tmdb_id);
      doneAiredEpisodes = airedEpisodes;
    }

    const noLaterAiredEpisode = latestTv
      ? (await findNextEpisode(r.tmdb_id, latestTv.season, latestTv.episode)) === null
      : false;
    const caughtUp = !!latestTv
      && latestTv.duration > 0
      && latestTv.position >= latestTv.duration * WATCHED_THRESHOLD
      && noLaterAiredEpisode;

    if (status === 'done' && doneAiredEpisodes > 0 && airedEpisodes > doneAiredEpisodes) {
      status = 'in_progress';
      db.prepare(`
        UPDATE watchlist SET status = 'in_progress'
        WHERE user_id = ? AND tmdb_id = ? AND media_type = 'tv'
      `).run(req.user!.id, r.tmdb_id);
    }

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
      caught_up: caughtUp,
      watch_status_text: formatTvStatusText(tmdb, prog.watched_count, doneAiredEpisodes, caughtUp),
      next_release_text: formatNextReleaseText(tmdb),
      resume_season: resume?.season,
      resume_episode: resume?.episode,
      ...(inFlight ? { position: inFlight.position, duration: inFlight.duration } : {})
    };
  }));

  const items = statusFilter ? allItems.filter(item => item.status === statusFilter) : allItems;
  res.json({ items });
});

router.patch('/user/watchlist/:type/:tmdb_id', requireAuth, async (req, res) => {
  const tmdb_id = toInt(req.params.tmdb_id, { min: 1 });
  const type = req.params.type;
  const body = req.body || {};
  const status = body.status;
  const folderName = normalizeFolderName(body.folder_name);
  if (!tmdb_id || !['movie', 'tv'].includes(type)) return res.status(400).json({ error: 'invalid_params' });
  if (status !== undefined && !['todo', 'in_progress', 'done'].includes(status)) return res.status(400).json({ error: 'invalid_status' });
  if (body.folder_name !== undefined && folderName === undefined) {
    return res.status(400).json({ error: 'invalid_folder_name' });
  }
  if (status === undefined && body.folder_name === undefined) {
    return res.status(400).json({ error: 'missing_fields' });
  }

  if (status === undefined) {
    const mediaType = type as 'movie' | 'tv';
    const result = db.prepare(`
      UPDATE watchlist SET folder_name = ?
      WHERE user_id = ? AND tmdb_id = ? AND media_type = ?
    `).run(folderName ?? null, req.user!.id, tmdb_id, type);
    if (result.changes === 0) return res.status(404).json({ error: 'not_found' });
    publishUserWatchlistChanged(req.user!.id, {
      reason: 'folder-changed',
      tmdb_id,
      media_type: mediaType
    });
    return res.json({ ok: true, folder_name: folderName ?? null });
  }

  if (type === 'tv' && status === 'done') {
    const summary = await getTmdbTvSummary(tmdb_id);
    const doneAiredEpisodes = getAiredEpisodesCount(summary);
    const result = db.prepare(`
      UPDATE watchlist SET status = ?, done_aired_episodes = ?
      WHERE user_id = ? AND tmdb_id = ? AND media_type = ?
    `).run(status, doneAiredEpisodes, req.user!.id, tmdb_id, type);
    if (result.changes === 0) return res.status(404).json({ error: 'not_found' });
  } else {
    // Don't touch done_aired_episodes when changing to other states
    const result = db.prepare(`
      UPDATE watchlist SET status = ?
      WHERE user_id = ? AND tmdb_id = ? AND media_type = ?
    `).run(status, req.user!.id, tmdb_id, type);
    if (result.changes === 0) return res.status(404).json({ error: 'not_found' });
  }

  publishUserWatchlistChanged(req.user!.id, {
    reason: 'watchlist-changed',
    tmdb_id,
    media_type: type as 'movie' | 'tv'
  });
  res.json({ ok: true });
});

router.delete('/user/watchlist/:type/:tmdb_id', requireAuth, (req, res) => {
  const tmdb_id = toInt(req.params.tmdb_id, { min: 1 });
  const type = req.params.type;
  if (!tmdb_id || !['movie', 'tv'].includes(type)) return res.status(400).json({ error: 'invalid_params' });
  db.prepare(`DELETE FROM watchlist WHERE user_id = ? AND tmdb_id = ? AND media_type = ?`).run(req.user!.id, tmdb_id, type);
  publishUserWatchlistChanged(req.user!.id, {
    reason: 'watchlist-changed',
    tmdb_id,
    media_type: type as 'movie' | 'tv'
  });
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
