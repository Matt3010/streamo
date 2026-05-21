import { Router } from 'express';
import { sql } from 'kysely';
import { kdb, withTx } from '../db';
import { requireAuth } from '../middleware/auth';
import { toInt } from '../utils/validation';
import { CONTINUE_HIDE_THRESHOLD, WATCHED_THRESHOLD, isMediaType } from '../config';
import { getAiredEpisodesCount, getTmdbTvSummary } from '../services/tmdb-cache';
import { findNextEpisode, resolveNextPlayable } from '../services/next-episode';
import { notifyAdminSessionsChanged } from '../services/admin-live';
import { publishUserWatchlistChanged } from '../services/user-live';
import { formatMovieRemaining, formatTvStatusText } from '../services/watch-status';
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
  watch_status_text?: string;
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
  if (!isMediaType(media_type)) return res.status(400).json({ error: 'invalid_type' });

  // Wrap insert + delete in a single transaction so a crash in the middle
  // can't leave the user with a fresh "Continua a guardare" entry that's
  // still hidden by an old hidden_continue row. maybeAutoCompleteWatchlist
  // is intentionally OUT of the tx — it does a TMDB fetch and its own
  // UPDATE, which is safe to run independently (the watchlist UPDATE is
  // idempotent and best-effort).
  await withTx(async (trx) => {
    await trx
      .insertInto('progress')
      .values({
        user_id: req.user!.id,
        tmdb_id, media_type, season, episode, position, duration, synthetic: 0,
        title: body.title || null,
        poster: body.poster || null,
        backdrop: body.backdrop || null,
        updated_at: sql<number>`EXTRACT(EPOCH FROM NOW())::BIGINT`
      })
      .onConflict((oc) => oc
        .columns(['user_id', 'tmdb_id', 'media_type', 'season', 'episode'])
        .doUpdateSet({
          position: (eb) => eb.ref('excluded.position'),
          duration: (eb) => eb.ref('excluded.duration'),
          synthetic: 0,
          title: (eb) => sql<string | null>`COALESCE(${eb.ref('excluded.title')}, ${eb.ref('progress.title')})`,
          poster: (eb) => sql<string | null>`COALESCE(${eb.ref('excluded.poster')}, ${eb.ref('progress.poster')})`,
          backdrop: (eb) => sql<string | null>`COALESCE(${eb.ref('excluded.backdrop')}, ${eb.ref('progress.backdrop')})`,
          updated_at: sql<number>`EXTRACT(EPOCH FROM NOW())::BIGINT`
        })
      )
      .execute();

    await trx
      .deleteFrom('hidden_continue')
      .where('user_id', '=', req.user!.id)
      .where('tmdb_id', '=', tmdb_id)
      .where('media_type', '=', media_type)
      .execute();
  });

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
  const wl = await kdb
    .selectFrom('watchlist')
    .select('status')
    .where('user_id', '=', userId)
    .where('tmdb_id', '=', tmdbId)
    .where('media_type', '=', mediaType)
    .executeTakeFirst();
  if (!wl) return false;

  if (wl.status === 'todo') {
    const result = await kdb
      .updateTable('watchlist')
      .set({ status: 'in_progress' })
      .where('user_id', '=', userId)
      .where('tmdb_id', '=', tmdbId)
      .where('media_type', '=', mediaType)
      .executeTakeFirst();
    return Number(result.numUpdatedRows) > 0;
  }

  if (wl.status === 'done') return false;

  if (mediaType === 'movie') {
    const row = await kdb
      .selectFrom('progress')
      .select(['position', 'duration'])
      .where('user_id', '=', userId)
      .where('tmdb_id', '=', tmdbId)
      .where('media_type', '=', 'movie')
      .where('season', '=', 0)
      .where('episode', '=', 0)
      .where('synthetic', '=', 0)
      .executeTakeFirst();
    if (row && row.duration > 0 && row.position >= row.duration * WATCHED_THRESHOLD) {
      const result = await kdb
        .updateTable('watchlist')
        .set({ status: 'done', done_aired_episodes: 0 })
        .where('user_id', '=', userId)
        .where('tmdb_id', '=', tmdbId)
        .where('media_type', '=', 'movie')
        .executeTakeFirst();
      return Number(result.numUpdatedRows) > 0;
    }
    return false;
  }

  const summary = await getTmdbTvSummary(tmdbId);
  const airedEp = getAiredEpisodesCount(summary);
  if (!airedEp) return false;

  const cnt = await kdb
    .selectFrom('progress')
    .select((eb) => eb.fn
      .sum<number>(sql<number>`CASE WHEN duration > 0 AND position >= duration * ${WATCHED_THRESHOLD} THEN 1 ELSE 0 END`)
      .as('watched'))
    .where('user_id', '=', userId)
    .where('tmdb_id', '=', tmdbId)
    .where('media_type', '=', 'tv')
    .where('synthetic', '=', 0)
    .executeTakeFirst();

  const latest = await kdb
    .selectFrom('progress')
    .select(['season', 'episode', 'position', 'duration'])
    .where('user_id', '=', userId)
    .where('tmdb_id', '=', tmdbId)
    .where('media_type', '=', 'tv')
    .where('synthetic', '=', 0)
    .orderBy('updated_at', 'desc')
    .orderBy('season', 'desc')
    .orderBy('episode', 'desc')
    .limit(1)
    .executeTakeFirst();

  const noLaterAiredEpisode = latest
    ? (await findNextEpisode(tmdbId, latest.season, latest.episode)) === null
    : false;
  const caughtUp = !!latest
    && latest.duration > 0
    && latest.position >= latest.duration * WATCHED_THRESHOLD
    && noLaterAiredEpisode;

  if ((Number(cnt?.watched ?? 0)) >= airedEp || caughtUp) {
    const result = await kdb
      .updateTable('watchlist')
      .set({ status: 'done', done_aired_episodes: airedEp })
      .where('user_id', '=', userId)
      .where('tmdb_id', '=', tmdbId)
      .where('media_type', '=', 'tv')
      .executeTakeFirst();
    return Number(result.numUpdatedRows) > 0;
  }
  return false;
}

router.get('/user/progress', requireAuth, async (req, res) => {
  // Window function + correlated NOT EXISTS clauses — clearer as raw SQL.
  const rows = await sql<ProgressRow>`
    SELECT tmdb_id, media_type, season, episode, position, duration,
           title, poster, backdrop, updated_at
    FROM (
      SELECT p.*, ROW_NUMBER() OVER (
        PARTITION BY p.tmdb_id, p.media_type
        ORDER BY p.updated_at DESC, p.season DESC, p.episode DESC
      ) AS rn
      FROM progress p
      WHERE p.user_id = ${req.user!.id}
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
  `.execute(kdb).then((r) => r.rows);

  const tvTmdbIds = rows.filter(r => r.media_type === 'tv').map(r => r.tmdb_id);
  const watchedByTmdb = new Map<number, number>();
  if (tvTmdbIds.length > 0) {
    const counts = await sql<{ tmdb_id: number; watched_count: number }>`
      SELECT tmdb_id,
             SUM(CASE WHEN duration > 0 AND position >= duration * ${WATCHED_THRESHOLD} THEN 1 ELSE 0 END)::int AS watched_count
      FROM progress
      WHERE user_id = ${req.user!.id}
        AND media_type = 'tv'
        AND synthetic = 0
        AND tmdb_id = ANY(${tvTmdbIds}::int[])
      GROUP BY tmdb_id
    `.execute(kdb).then((r) => r.rows);
    for (const c of counts) {
      watchedByTmdb.set(Number(c.tmdb_id), Number(c.watched_count));
    }
  }

  const items = await Promise.all(rows.map(async (row): Promise<ProgressRow | null> => {
    if (row.media_type === 'movie') {
      const movieNearEnd = row.duration > 0 && row.position >= row.duration * CONTINUE_HIDE_THRESHOLD;
      if (movieNearEnd) return null;
      return { ...row, watch_status_text: formatMovieRemaining(row.position, row.duration) };
    }

    // Tolerate float imprecision: a saved position 0.25s shy of duration
    // still means the episode is done. WATCHED_THRESHOLD lines this up with
    // the same cutoff used for watched_count aggregation above.
    const ended = row.duration > 0 && row.position >= row.duration * WATCHED_THRESHOLD;
    let resolvedRow: ProgressRow = row;
    if (ended) {
      const next = await findNextEpisode(row.tmdb_id, row.season, row.episode);
      if (!next) return null;
      resolvedRow = { ...row, season: next.season, episode: next.episode, position: 0, duration: 0 };
    }

    const tmdb = await getTmdbTvSummary(resolvedRow.tmdb_id);
    const noLaterAiredEpisode = (await findNextEpisode(resolvedRow.tmdb_id, resolvedRow.season, resolvedRow.episode)) === null;
    const caughtUp = resolvedRow.duration > 0
      && resolvedRow.position >= resolvedRow.duration * WATCHED_THRESHOLD
      && noLaterAiredEpisode;
    const watchedCount = watchedByTmdb.get(resolvedRow.tmdb_id) ?? 0;
    const statusText = formatTvStatusText(tmdb, watchedCount, 0, caughtUp);
    return statusText ? { ...resolvedRow, watch_status_text: statusText } : resolvedRow;
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

  const items = await kdb
    .selectFrom('progress')
    .select(['season', 'episode', 'position', 'duration'])
    .where('user_id', '=', req.user!.id)
    .where('tmdb_id', '=', tmdb_id)
    .where('media_type', '=', 'tv')
    .where('synthetic', '=', 0)
    .execute();
  res.json({ items });
});

router.delete('/user/progress/title/:type/:tmdb_id', requireAuth, async (req, res) => {
  const tmdb_id = toInt(req.params.tmdb_id, { min: 1 });
  const type = req.params.type;
  if (!tmdb_id || !isMediaType(type)) return res.status(400).json({ error: 'invalid_params' });

  await kdb
    .insertInto('hidden_continue')
    .values({
      user_id: req.user!.id, tmdb_id, media_type: type,
      hidden_at: sql<number>`EXTRACT(EPOCH FROM NOW())::BIGINT`
    })
    .onConflict((oc) => oc
      .columns(['user_id', 'tmdb_id', 'media_type'])
      .doUpdateSet({ hidden_at: sql<number>`EXTRACT(EPOCH FROM NOW())::BIGINT` })
    )
    .execute();

  notifyAdminSessionsChanged();
  res.json({ ok: true });
});

router.get('/user/progress/:type/:tmdb_id/:season?/:episode?', requireAuth, async (req, res) => {
  const tmdb_id = toInt(req.params.tmdb_id, { min: 1 });
  const season = toInt(req.params.season ?? 0, { min: 0 }) ?? 0;
  const episode = toInt(req.params.episode ?? 0, { min: 0 }) ?? 0;
  const type = req.params.type;
  if (!tmdb_id || !isMediaType(type)) return res.status(400).json({ error: 'invalid_params' });

  const row = await kdb
    .selectFrom('progress')
    .select(['position', 'duration'])
    .where('user_id', '=', req.user!.id)
    .where('tmdb_id', '=', tmdb_id)
    .where('media_type', '=', type)
    .where('season', '=', season)
    .where('episode', '=', episode)
    .where('synthetic', '=', 0)
    .executeTakeFirst();
  res.json({ progress: row || null });
});

router.delete('/user/progress/:type/:tmdb_id/:season?/:episode?', requireAuth, async (req, res) => {
  const tmdb_id = toInt(req.params.tmdb_id, { min: 1 });
  const season = toInt(req.params.season ?? 0, { min: 0 }) ?? 0;
  const episode = toInt(req.params.episode ?? 0, { min: 0 }) ?? 0;
  const type = req.params.type;
  if (!tmdb_id || !isMediaType(type)) return res.status(400).json({ error: 'invalid_params' });

  await kdb
    .deleteFrom('progress')
    .where('user_id', '=', req.user!.id)
    .where('tmdb_id', '=', tmdb_id)
    .where('media_type', '=', type)
    .where('season', '=', season)
    .where('episode', '=', episode)
    .execute();
  notifyAdminSessionsChanged();
  res.json({ ok: true });
});

export default router;
