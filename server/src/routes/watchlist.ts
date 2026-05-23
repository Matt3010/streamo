import { Router } from 'express';
import { sql } from 'kysely';
import { kdb } from '../db';
import { requireAuth } from '../middleware/auth';
import { toInt } from '../utils/validation';
import { CONTINUE_HIDE_THRESHOLD, WATCHED_THRESHOLD, isMediaType } from '../config';
import {
  getAiredEpisodesCount,
  getTmdbMovieSummary,
  getTmdbTvSummary
} from '../services/tmdb-cache';
import { getWatchlistReleaseMeta } from '../../../shared/release-format';
import { formatMovieRemaining, formatTvStatusText } from '../services/watch-status';
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

router.post('/user/watchlist', requireAuth, async (req, res) => {
  const body = req.body || {};
  const tmdb_id = toInt(body.tmdb_id, { min: 1 });
  const media_type = body.media_type;
  if (!tmdb_id || !media_type) return res.status(400).json({ error: 'missing_fields' });
  if (!isMediaType(media_type)) return res.status(400).json({ error: 'invalid_type' });

  await kdb
    .insertInto('watchlist')
    .values({
      user_id: req.user!.id, tmdb_id, media_type,
      title: body.title || null,
      poster: body.poster || null
    })
    .onConflict((oc) => oc.columns(['user_id', 'tmdb_id', 'media_type']).doNothing())
    .execute();

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
  if (mediaFilter && !isMediaType(mediaFilter)) {
    return res.status(400).json({ error: 'invalid_type' });
  }

  let wlQuery = kdb
    .selectFrom('watchlist')
    .select([
      'tmdb_id', 'media_type', 'title', 'poster', 'status',
      'folder_name', 'done_aired_episodes', 'added_at'
    ])
    .where('user_id', '=', req.user!.id);

  if (mediaFilter) {
    wlQuery = wlQuery.where('media_type', '=', mediaFilter);
  }

  const rows = await wlQuery.orderBy('added_at', 'desc').execute() as WatchlistRow[];

  const latestProgress = new Map<string, { position: number; duration: number }>();
  if (rows.length > 0) {
    const latestRows = await sql<{ tmdb_id: number; media_type: string; position: number; duration: number }>`
      SELECT tmdb_id, media_type, position, duration FROM (
        SELECT tmdb_id, media_type, position, duration, updated_at,
               ROW_NUMBER() OVER (PARTITION BY tmdb_id, media_type ORDER BY updated_at DESC) AS rn
        FROM progress
        WHERE user_id = ${req.user!.id}
          AND synthetic = 0
      ) p
      WHERE rn = 1
        AND duration > 0
        AND position > 5
        AND position < duration * ${CONTINUE_HIDE_THRESHOLD}
    `.execute(kdb).then((r) => r.rows);
    for (const p of latestRows) {
      latestProgress.set(`${p.media_type}:${p.tmdb_id}`, { position: p.position, duration: p.duration });
    }
  }

  const tvIds = rows.filter(r => r.media_type === 'tv').map(r => r.tmdb_id);
  const progressByTmdb = new Map<number, ProgressAggregate>();
  const latestTvProgressByTmdb = new Map<number, LatestTvProgressRow>();
  if (tvIds.length > 0) {
    // Single-pass aggregate: per-series watched_count + the (season, episode)
    // pair with the highest season (and within that season the highest
    // episode). Replaces the previous N+1 that fired one max(episode) query
    // per series.
    const aggregates = await sql<{
      tmdb_id: number;
      last_season: number;
      last_episode: number;
      watched_count: number;
    }>`
      WITH ranked AS (
        SELECT
          tmdb_id,
          season,
          episode,
          ROW_NUMBER() OVER (PARTITION BY tmdb_id ORDER BY season DESC, episode DESC) AS rn
        FROM progress
        WHERE user_id = ${req.user!.id}
          AND media_type = 'tv'
          AND synthetic = 0
          AND tmdb_id = ANY(${tvIds}::int[])
      ),
      counts AS (
        SELECT
          tmdb_id,
          SUM(CASE WHEN duration > 0 AND position >= duration * ${WATCHED_THRESHOLD} THEN 1 ELSE 0 END)::int AS watched_count
        FROM progress
        WHERE user_id = ${req.user!.id}
          AND media_type = 'tv'
          AND synthetic = 0
          AND tmdb_id = ANY(${tvIds}::int[])
        GROUP BY tmdb_id
      )
      SELECT r.tmdb_id, r.season AS last_season, r.episode AS last_episode, c.watched_count
      FROM ranked r
      JOIN counts c ON c.tmdb_id = r.tmdb_id
      WHERE r.rn = 1
    `.execute(kdb).then((r) => r.rows);

    for (const a of aggregates) {
      progressByTmdb.set(a.tmdb_id, {
        last_season: Number(a.last_season),
        last_episode: Number(a.last_episode),
        watched_count: Number(a.watched_count)
      });
    }

    const latestRows = await sql<{ tmdb_id: number; season: number; episode: number; position: number; duration: number }>`
      SELECT tmdb_id, season, episode, position, duration FROM (
        SELECT tmdb_id, season, episode, position, duration, updated_at,
               ROW_NUMBER() OVER (PARTITION BY tmdb_id ORDER BY updated_at DESC, season DESC, episode DESC) AS rn
        FROM progress
        WHERE user_id = ${req.user!.id} AND media_type = 'tv' AND synthetic = 0 AND tmdb_id = ANY(${tvIds}::int[])
      ) p
      WHERE rn = 1
    `.execute(kdb).then((r) => r.rows);

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
      await kdb
        .updateTable('watchlist')
        .set({ done_aired_episodes: airedEpisodes })
        .where('user_id', '=', req.user!.id)
        .where('tmdb_id', '=', r.tmdb_id)
        .where('media_type', '=', 'tv')
        .execute();
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
      await kdb
        .updateTable('watchlist')
        .set({ status: 'in_progress' })
        .where('user_id', '=', req.user!.id)
        .where('tmdb_id', '=', r.tmdb_id)
        .where('media_type', '=', 'tv')
        .execute();
    } else if (status === 'in_progress' && caughtUp && airedEpisodes > 0) {
      // Symmetric counterpart to the done→in_progress bump above. The POST
      // /user/progress handler already calls maybeAutoCompleteWatchlist on
      // each save, but rare timing/order-of-watch edge cases can leave an
      // in_progress row paired with caughtUp=true. Surface here so the
      // watchlist tab the user is reading reflects reality.
      status = 'done';
      doneAiredEpisodes = airedEpisodes;
      await kdb
        .updateTable('watchlist')
        .set({ status: 'done', done_aired_episodes: airedEpisodes })
        .where('user_id', '=', req.user!.id)
        .where('tmdb_id', '=', r.tmdb_id)
        .where('media_type', '=', 'tv')
        .execute();
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
      watch_status_text: formatTvStatusText(tmdb, prog.watched_count, doneAiredEpisodes, caughtUp, resume),
      next_release_text: releaseMeta.text,
      resume_season: resume?.season,
      resume_episode: resume?.episode,
      // Drop the in-flight progress when it belongs to a *different* episode
      // than the one we're displaying (resume). After the user crosses
      // the shared completion threshold on S2E1, latestTv still points at S2E1 but resume
      // advances to S2E2 — painting position/duration against the displayed
      // S/E renders "S2 E2 90%" while the 90% is actually S2E1. /user/progress
      // already zeroes out position/duration in the same advancement case.
      ...(inFlight && latestTv && resume
          && latestTv.season === resume.season
          && latestTv.episode === resume.episode
          ? { position: inFlight.position, duration: inFlight.duration }
          : {})
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
  if (!tmdb_id || !isMediaType(type)) return res.status(400).json({ error: 'invalid_params' });
  if (status !== undefined && !['todo', 'in_progress', 'done'].includes(status)) return res.status(400).json({ error: 'invalid_status' });
  if (body.folder_name !== undefined && folderName === undefined) {
    return res.status(400).json({ error: 'invalid_folder_name' });
  }
  if (status === undefined && body.folder_name === undefined) {
    return res.status(400).json({ error: 'missing_fields' });
  }

  if (status === undefined) {
    const mediaType = type as 'movie' | 'tv';
    const result = await kdb
      .updateTable('watchlist')
      .set({ folder_name: folderName ?? null })
      .where('user_id', '=', req.user!.id)
      .where('tmdb_id', '=', tmdb_id)
      .where('media_type', '=', type)
      .executeTakeFirst();
    if (Number(result.numUpdatedRows) === 0) return res.status(404).json({ error: 'not_found' });
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
    const result = await kdb
      .updateTable('watchlist')
      .set({ status, done_aired_episodes: doneAiredEpisodes })
      .where('user_id', '=', req.user!.id)
      .where('tmdb_id', '=', tmdb_id)
      .where('media_type', '=', type)
      .executeTakeFirst();
    if (Number(result.numUpdatedRows) === 0) return res.status(404).json({ error: 'not_found' });
  } else {
    const result = await kdb
      .updateTable('watchlist')
      .set({ status })
      .where('user_id', '=', req.user!.id)
      .where('tmdb_id', '=', tmdb_id)
      .where('media_type', '=', type)
      .executeTakeFirst();
    if (Number(result.numUpdatedRows) === 0) return res.status(404).json({ error: 'not_found' });
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
  if (!tmdb_id || !isMediaType(type)) return res.status(400).json({ error: 'invalid_params' });
  await kdb
    .deleteFrom('watchlist')
    .where('user_id', '=', req.user!.id)
    .where('tmdb_id', '=', tmdb_id)
    .where('media_type', '=', type)
    .execute();
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
  if (!tmdb_id || !isMediaType(type)) return res.status(400).json({ error: 'invalid_params' });
  const row = await kdb
    .selectFrom('watchlist')
    .select(sql<number>`1`.as('in_list'))
    .where('user_id', '=', req.user!.id)
    .where('tmdb_id', '=', tmdb_id)
    .where('media_type', '=', type)
    .executeTakeFirst();
  res.json({ in_list: !!row });
});

export default router;
