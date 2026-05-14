import { Router } from 'express';
import { db } from '../db';
import { requireAuth } from '../middleware/auth';
import { toInt } from '../utils/validation';
import { WATCHED_THRESHOLD } from '../config';
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

router.post('/user/history', requireAuth, (req, res) => {
  const body = req.body || {};
  const tmdb_id = toInt(body.tmdb_id, { min: 1 });
  const media_type = body.media_type;
  const season = toInt(body.season ?? 0, { min: 0 }) ?? 0;
  const episode = toInt(body.episode ?? 0, { min: 0 }) ?? 0;

  if (!tmdb_id || !media_type) return res.status(400).json({ error: 'missing_fields' });
  if (!['movie', 'tv'].includes(media_type)) return res.status(400).json({ error: 'invalid_type' });

  db.prepare(`
    INSERT INTO history (user_id, tmdb_id, media_type, season, episode, title, poster, watched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%s','now'))
    ON CONFLICT(user_id, tmdb_id, media_type, season, episode) DO UPDATE SET
      title = COALESCE(excluded.title, title),
      poster = COALESCE(excluded.poster, poster),
      watched_at = strftime('%s','now')
  `).run(req.user!.id, tmdb_id, media_type, season, episode, body.title || null, body.poster || null);
  res.json({ ok: true });
});

router.get('/user/history', requireAuth, async (req, res) => {
  const mediaFilter = typeof req.query.media_type === 'string' ? req.query.media_type : '';
  if (mediaFilter && !['movie', 'tv'].includes(mediaFilter)) {
    return res.status(400).json({ error: 'invalid_type' });
  }

  const where = ['h.user_id = ?'];
  const params: Array<number | string> = [req.user!.id];
  if (mediaFilter) {
    where.push('h.media_type = ?');
    params.push(mediaFilter);
  }

  const rows = db.prepare(`
    SELECT
      h.tmdb_id,
      h.media_type,
      h.season,
      h.episode,
      h.title,
      h.poster,
      h.watched_at,
      p.position,
      p.duration
    FROM history h
    LEFT JOIN progress p
      ON p.user_id = h.user_id
      AND p.tmdb_id = h.tmdb_id
      AND p.media_type = h.media_type
      AND p.season = h.season
      AND p.episode = h.episode
      AND p.synthetic = 0
    WHERE ${where.join(' AND ')}
    ORDER BY h.watched_at DESC, h.id DESC
    LIMIT 100
  `).all(...params) as HistoryRow[];

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

router.delete('/user/history', requireAuth, (req, res) => {
  db.prepare('DELETE FROM history WHERE user_id = ?').run(req.user!.id);
  res.json({ ok: true });
});

router.delete('/user/history/:type/:tmdb_id', requireAuth, (req, res) => {
  const tmdb_id = toInt(req.params.tmdb_id, { min: 1 });
  const type = req.params.type;
  const season = toInt(req.query.season, { min: 0 });
  const episode = toInt(req.query.episode, { min: 0 });
  if (!tmdb_id || !['movie', 'tv'].includes(type)) return res.status(400).json({ error: 'invalid_params' });

  if (season !== null && season !== undefined && episode !== null && episode !== undefined) {
    db.prepare(`
      DELETE FROM history
      WHERE user_id = ? AND tmdb_id = ? AND media_type = ? AND season = ? AND episode = ?
    `).run(req.user!.id, tmdb_id, type, season, episode);
    return res.json({ ok: true });
  }

  db.prepare(`
    DELETE FROM history WHERE user_id = ? AND tmdb_id = ? AND media_type = ?
  `).run(req.user!.id, tmdb_id, type);
  res.json({ ok: true });
});

export default router;
