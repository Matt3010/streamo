import { Router } from 'express';
import { sql } from 'kysely';
import { kdb } from '../db';
import { requireAuth } from '../middleware/auth';
import { toInt } from '../utils/validation';
import { WATCHED_THRESHOLD, isMediaType } from '../config';
import { resolveNextPlayable } from '../services/next-episode';
import type { HistoryItem } from '../../../shared/types';

const router = Router();

interface HistoryRow {
  tmdb_id: number;
  media_type: 'movie' | 'tv';
  season: number;
  episode: number;
  title: string | null;
  poster: string | null;
  watched_at: number;
  position: number | null;
  duration: number | null;
}

function formatViewedMinutes(position: number | null | undefined): string | undefined {
  if (!position || position <= 0) return undefined;
  const minutes = Math.max(1, Math.floor(position / 60));
  return minutes === 1 ? 'Visto 1 min' : `Visti ${minutes} min`;
}

function isCompleted(position: number | null | undefined, duration: number | null | undefined): boolean {
  return !!duration && duration > 0 && !!position && position >= duration * WATCHED_THRESHOLD;
}

router.post('/user/history', requireAuth, async (req, res) => {
  const body = req.body || {};
  const tmdb_id = toInt(body.tmdb_id, { min: 1 });
  const media_type = body.media_type;
  const season = toInt(body.season ?? 0, { min: 0 }) ?? 0;
  const episode = toInt(body.episode ?? 0, { min: 0 }) ?? 0;

  if (!tmdb_id || !media_type) return res.status(400).json({ error: 'missing_fields' });
  if (!isMediaType(media_type)) return res.status(400).json({ error: 'invalid_type' });

  await kdb
    .insertInto('history')
    .values({
      user_id: req.user!.id,
      tmdb_id,
      media_type,
      season,
      episode,
      title: body.title || null,
      poster: body.poster || null,
      watched_at: sql<number>`EXTRACT(EPOCH FROM NOW())::BIGINT`
    })
    .onConflict((oc) => oc
      .columns(['user_id', 'tmdb_id', 'media_type', 'season', 'episode'])
      .doUpdateSet({
        title: (eb) => sql<string | null>`COALESCE(${eb.ref('excluded.title')}, ${eb.ref('history.title')})`,
        poster: (eb) => sql<string | null>`COALESCE(${eb.ref('excluded.poster')}, ${eb.ref('history.poster')})`,
        watched_at: sql<number>`EXTRACT(EPOCH FROM NOW())::BIGINT`
      })
    )
    .execute();
  res.json({ ok: true });
});

router.get('/user/history', requireAuth, async (req, res) => {
  const mediaFilter = typeof req.query.media_type === 'string' ? req.query.media_type : '';
  if (mediaFilter && !isMediaType(mediaFilter)) {
    return res.status(400).json({ error: 'invalid_type' });
  }

  let q = kdb
    .selectFrom('history as h')
    .leftJoin('progress as p', (join) => join
      .onRef('p.user_id', '=', 'h.user_id')
      .onRef('p.tmdb_id', '=', 'h.tmdb_id')
      .onRef('p.media_type', '=', 'h.media_type')
      .onRef('p.season', '=', 'h.season')
      .onRef('p.episode', '=', 'h.episode')
      .on('p.synthetic', '=', 0))
    .select([
      'h.tmdb_id', 'h.media_type', 'h.season', 'h.episode',
      'h.title', 'h.poster', 'h.watched_at',
      'p.position', 'p.duration'
    ])
    .where('h.user_id', '=', req.user!.id);

  if (mediaFilter) {
    q = q.where('h.media_type', '=', mediaFilter);
  }

  const rows = await q
    .orderBy('h.watched_at', 'desc')
    .orderBy('h.id', 'desc')
    .limit(100)
    .execute() as HistoryRow[];

  const latestEntryByTitle = new Set<string>();
  const seenTitles = new Set<string>();
  for (const row of rows) {
    const key = `${row.media_type}:${row.tmdb_id}`;
    if (!seenTitles.has(key)) {
      seenTitles.add(key);
      latestEntryByTitle.add(`${key}:${row.season}:${row.episode}`);
    }
  }

  const items: HistoryItem[] = await Promise.all(rows.map(async (row) => {
    const completed = isCompleted(row.position, row.duration);
    const isLatestEntryForTitle = latestEntryByTitle.has(`${row.media_type}:${row.tmdb_id}:${row.season}:${row.episode}`);
    const resume = row.media_type === 'tv' && completed && isLatestEntryForTitle
      ? await resolveNextPlayable(req.user!.id, row.tmdb_id)
      : null;
    const hasNextResume = !!resume
      && (resume.season !== row.season || resume.episode !== row.episode);

    return {
      tmdb_id: row.tmdb_id,
      media_type: row.media_type,
      season: row.season,
      episode: row.episode,
      title: row.title,
      poster: row.poster,
      watched_at: row.watched_at,
      position: row.position ?? undefined,
      duration: row.duration ?? undefined,
      completed,
      watch_status_text: completed ? 'Completato' : formatViewedMinutes(row.position),
      resume_text: hasNextResume ? `Riprendi da S${resume!.season} E${resume!.episode}` : undefined,
      resume_season: hasNextResume ? resume!.season : undefined,
      resume_episode: hasNextResume ? resume!.episode : undefined
    };
  }));

  res.json({ items });
});

router.delete('/user/history', requireAuth, async (req, res) => {
  await kdb.deleteFrom('history').where('user_id', '=', req.user!.id).execute();
  res.json({ ok: true });
});

router.delete('/user/history/:type/:tmdb_id', requireAuth, async (req, res) => {
  const tmdb_id = toInt(req.params.tmdb_id, { min: 1 });
  const type = req.params.type;
  const season = toInt(req.query.season, { min: 0 });
  const episode = toInt(req.query.episode, { min: 0 });
  if (!tmdb_id || !isMediaType(type)) return res.status(400).json({ error: 'invalid_params' });

  if (season !== null && season !== undefined && episode !== null && episode !== undefined) {
    await kdb
      .deleteFrom('history')
      .where('user_id', '=', req.user!.id)
      .where('tmdb_id', '=', tmdb_id)
      .where('media_type', '=', type)
      .where('season', '=', season)
      .where('episode', '=', episode)
      .execute();
    return res.json({ ok: true });
  }

  await kdb
    .deleteFrom('history')
    .where('user_id', '=', req.user!.id)
    .where('tmdb_id', '=', tmdb_id)
    .where('media_type', '=', type)
    .execute();
  res.json({ ok: true });
});

export default router;
