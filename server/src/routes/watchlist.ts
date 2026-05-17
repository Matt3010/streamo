import { Router } from 'express';
import { query } from '../db';
import { requireAuth } from '../middleware/auth';
import { toInt } from '../utils/validation';
import { CONTINUE_HIDE_THRESHOLD, WATCHED_THRESHOLD } from '../config';
import {
  getAiredEpisodesCount,
  getBaseAiredEpisodesCount,
  getTmdbMovieSummary,
  getTmdbTvSummary,
  type TmdbTvSummary
} from '../services/tmdb-cache';
import { formatNewEpisodesMessage, getWatchlistReleaseMeta } from '../../../shared/release-format';
import { findNextEpisode, resolveNextPlayable } from '../services/next-episode';
import { publishUserWatchlistChanged } from '../services/user-live';
import { enqueueWatchlistTitleRefresh } from '../services/watchlist-jobs';
import type { WatchlistItem, WatchlistListStatusFilter } from '../../../shared/types';

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

  const watchedBaseline = Math.max(watchedCount, doneAiredEpisodes);
  const remaining = Math.max(0, airedEpisodes - watchedBaseline);

  const newEpisodes = Math.max(0, airedEpisodes - baseAiredEpisodes);
  if (newEpisodes > 0 && remaining > 0) {
    return formatNewEpisodesMessage(Math.min(newEpisodes, remaining));
  }

  if (caughtUp) return 'Sei al passo';

  if (watchedBaseline <= 0) return undefined;

  if (remaining === 0) return 'Sei al passo';
  return remaining === 1 ? 'Manca 1 episodio' : `Mancano ${remaining} episodi`;
}

router.post('/user/watchlist', requireAuth, async (req, res) => {
  const body = req.body || {};
  const tmdb_id = toInt(body.tmdb_id, { min: 1 });
  const media_type = body.media_type;
  if (!tmdb_id || !media_type) return res.status(400).json({ error: 'missing_fields' });
  if (!['movie', 'tv'].includes(media_type)) return res.status(400).json({ error: 'invalid_type' });
  await query(`
    INSERT INTO watchlist (user_id, tmdb_id, media_type, title, poster)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (user_id, tmdb_id, media_type) DO NOTHING
  `, [req.user!.id, tmdb_id, media_type, body.title || null, body.poster || null]);
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
  const statusFilter = typeof req.query.status === 'string'
    ? req.query.status as WatchlistListStatusFilter
    : '';
  const mediaFilter = typeof req.query.media_type === 'string' ? req.query.media_type : '';
  if (statusFilter && !['todo', 'in_progress', 'done', 'unreleased'].includes(statusFilter)) {
    return res.status(400).json({ error: 'invalid_status' });
  }
  if (mediaFilter && !['movie', 'tv'].includes(mediaFilter)) {
    return res.status(400).json({ error: 'invalid_type' });
  }

  const params: Array<number | string> = [req.user!.id];
  let whereExtra = '';
  if (mediaFilter) {
    params.push(mediaFilter);
    whereExtra = ` AND media_type = $${params.length}`;
  }

  const wlRes = await query<WatchlistRow>(`
    SELECT tmdb_id, media_type, title, poster, status, folder_name, done_aired_episodes, added_at
    FROM watchlist
    WHERE user_id = $1${whereExtra}
    ORDER BY added_at DESC
  `, params);
  const rows = wlRes.rows;

  const latestProgress = new Map<string, { position: number; duration: number }>();
  if (rows.length > 0) {
    const latestRes = await query<{ tmdb_id: number; media_type: string; position: number; duration: number }>(`
      SELECT tmdb_id, media_type, position, duration FROM (
        SELECT tmdb_id, media_type, position, duration, updated_at,
               ROW_NUMBER() OVER (PARTITION BY tmdb_id, media_type ORDER BY updated_at DESC) AS rn
        FROM progress
        WHERE user_id = $1
          AND synthetic = 0
      ) p
      WHERE rn = 1
        AND duration > 0
        AND position > 5
        AND position < duration * ${CONTINUE_HIDE_THRESHOLD}
    `, [req.user!.id]);
    for (const p of latestRes.rows) {
      latestProgress.set(`${p.media_type}:${p.tmdb_id}`, { position: p.position, duration: p.duration });
    }
  }

  const tvIds = rows.filter(r => r.media_type === 'tv').map(r => r.tmdb_id);
  const progressByTmdb = new Map<number, ProgressAggregate>();
  const latestTvProgressByTmdb = new Map<number, LatestTvProgressRow>();
  if (tvIds.length > 0) {
    const seasonsRes = await query<{ tmdb_id: number; max_season: number; watched_count: number }>(`
      SELECT tmdb_id,
        MAX(season) AS max_season,
        SUM(CASE WHEN duration > 0 AND position >= duration * ${WATCHED_THRESHOLD} THEN 1 ELSE 0 END)::INTEGER AS watched_count
      FROM progress
      WHERE user_id = $1 AND media_type = 'tv' AND synthetic = 0 AND tmdb_id = ANY($2::int[])
      GROUP BY tmdb_id
    `, [req.user!.id, tvIds]);
    for (const s of seasonsRes.rows) {
      const epRes = await query<{ max_episode: number | null }>(`
        SELECT MAX(episode) AS max_episode FROM progress
        WHERE user_id = $1 AND media_type = 'tv' AND synthetic = 0 AND tmdb_id = $2 AND season = $3
      `, [req.user!.id, s.tmdb_id, s.max_season]);
      progressByTmdb.set(s.tmdb_id, {
        last_season: s.max_season,
        last_episode: epRes.rows[0]?.max_episode ?? 0,
        watched_count: s.watched_count
      });
    }

    const latestRes = await query<{ tmdb_id: number; season: number; episode: number; position: number; duration: number }>(`
      SELECT tmdb_id, season, episode, position, duration FROM (
        SELECT tmdb_id, season, episode, position, duration, updated_at,
               ROW_NUMBER() OVER (PARTITION BY tmdb_id ORDER BY updated_at DESC, season DESC, episode DESC) AS rn
        FROM progress
        WHERE user_id = $1 AND media_type = 'tv' AND synthetic = 0 AND tmdb_id = ANY($2::int[])
      ) p
      WHERE rn = 1
    `, [req.user!.id, tvIds]);
    for (const row of latestRes.rows) {
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
      const tmdb = await getTmdbMovieSummary(r.tmdb_id);
      const releaseMeta = getWatchlistReleaseMeta(tmdb, 'movie');
      return {
        ...r,
        is_upcoming: releaseMeta.isUpcoming,
        next_release_text: releaseMeta.text,
        watch_status_text: formatMovieRemaining(inFlight?.position, inFlight?.duration),
        ...(inFlight ? { position: inFlight.position, duration: inFlight.duration } : {})
      };
    }

    const prog = progressByTmdb.get(r.tmdb_id) ?? { last_season: 0, last_episode: 0, watched_count: 0 };
    const latestTv = latestTvProgressByTmdb.get(r.tmdb_id);
    const tmdb = await getTmdbTvSummary(r.tmdb_id);
    const releaseMeta = getWatchlistReleaseMeta(tmdb, 'tv');
    const totalEpisodes = tmdb?.number_of_episodes ?? 0;
    const airedEpisodes = getAiredEpisodesCount(tmdb);
    const resume = await resolveNextPlayable(req.user!.id, r.tmdb_id);

    let status = r.status;
    let doneAiredEpisodes = r.done_aired_episodes ?? 0;

    if (status === 'done' && doneAiredEpisodes === 0 && airedEpisodes > 0) {
      await query(`
        UPDATE watchlist SET done_aired_episodes = $1
        WHERE user_id = $2 AND tmdb_id = $3 AND media_type = 'tv'
      `, [airedEpisodes, req.user!.id, r.tmdb_id]);
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
      await query(`
        UPDATE watchlist SET status = 'in_progress'
        WHERE user_id = $1 AND tmdb_id = $2 AND media_type = 'tv'
      `, [req.user!.id, r.tmdb_id]);
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
      is_upcoming: releaseMeta.isUpcoming,
      caught_up: caughtUp,
      watch_status_text: formatTvStatusText(tmdb, prog.watched_count, doneAiredEpisodes, caughtUp),
      next_release_text: releaseMeta.text,
      resume_season: resume?.season,
      resume_episode: resume?.episode,
      ...(inFlight ? { position: inFlight.position, duration: inFlight.duration } : {})
    };
  }));

  const items = statusFilter === 'unreleased'
    ? allItems.filter(item => item.is_upcoming === true)
    : statusFilter
      ? allItems.filter(item => item.status === statusFilter)
      : allItems;
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
    const result = await query(`
      UPDATE watchlist SET folder_name = $1
      WHERE user_id = $2 AND tmdb_id = $3 AND media_type = $4
    `, [folderName ?? null, req.user!.id, tmdb_id, type]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'not_found' });
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
    const result = await query(`
      UPDATE watchlist SET status = $1, done_aired_episodes = $2
      WHERE user_id = $3 AND tmdb_id = $4 AND media_type = $5
    `, [status, doneAiredEpisodes, req.user!.id, tmdb_id, type]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'not_found' });
  } else {
    const result = await query(`
      UPDATE watchlist SET status = $1
      WHERE user_id = $2 AND tmdb_id = $3 AND media_type = $4
    `, [status, req.user!.id, tmdb_id, type]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'not_found' });
  }

  publishUserWatchlistChanged(req.user!.id, {
    reason: 'watchlist-changed',
    tmdb_id,
    media_type: type as 'movie' | 'tv'
  });
  res.json({ ok: true });
});

router.delete('/user/watchlist/:type/:tmdb_id', requireAuth, async (req, res) => {
  const tmdb_id = toInt(req.params.tmdb_id, { min: 1 });
  const type = req.params.type;
  if (!tmdb_id || !['movie', 'tv'].includes(type)) return res.status(400).json({ error: 'invalid_params' });
  await query(
    'DELETE FROM watchlist WHERE user_id = $1 AND tmdb_id = $2 AND media_type = $3',
    [req.user!.id, tmdb_id, type]
  );
  publishUserWatchlistChanged(req.user!.id, {
    reason: 'watchlist-changed',
    tmdb_id,
    media_type: type as 'movie' | 'tv'
  });
  res.json({ ok: true });
});

router.get('/user/watchlist/check/:type/:tmdb_id', requireAuth, async (req, res) => {
  const tmdb_id = toInt(req.params.tmdb_id, { min: 1 });
  const type = req.params.type;
  if (!tmdb_id || !['movie', 'tv'].includes(type)) return res.status(400).json({ error: 'invalid_params' });
  const r = await query(`
    SELECT 1 as in_list FROM watchlist
    WHERE user_id = $1 AND tmdb_id = $2 AND media_type = $3
  `, [req.user!.id, tmdb_id, type]);
  res.json({ in_list: r.rowCount > 0 });
});

export default router;
