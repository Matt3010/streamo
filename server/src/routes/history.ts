import { Router } from 'express';
import { db } from '../db';
import { requireAuth } from '../middleware/auth';
import { toInt } from '../utils/validation';

const router = Router();

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

router.get('/user/history', requireAuth, (req, res) => {
  const mediaFilter = typeof req.query.media_type === 'string' ? req.query.media_type : '';
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
    SELECT tmdb_id, media_type, season, episode, title, poster, MAX(watched_at) as watched_at
    FROM history
    WHERE ${where.join(' AND ')}
    GROUP BY tmdb_id, media_type
    ORDER BY watched_at DESC
    LIMIT 50
  `).all(...params);
  res.json({ items: rows });
});

router.delete('/user/history', requireAuth, (req, res) => {
  db.prepare('DELETE FROM history WHERE user_id = ?').run(req.user!.id);
  res.json({ ok: true });
});

router.delete('/user/history/:type/:tmdb_id', requireAuth, (req, res) => {
  const tmdb_id = toInt(req.params.tmdb_id, { min: 1 });
  const type = req.params.type;
  if (!tmdb_id || !['movie', 'tv'].includes(type)) return res.status(400).json({ error: 'invalid_params' });
  db.prepare(`
    DELETE FROM history WHERE user_id = ? AND tmdb_id = ? AND media_type = ?
  `).run(req.user!.id, tmdb_id, type);
  res.json({ ok: true });
});

export default router;
