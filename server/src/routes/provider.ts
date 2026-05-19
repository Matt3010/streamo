import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { toInt } from '../utils/validation';
import { resolveProviderTitle } from '../services/provider-resolver';

const router = Router();

router.post('/user/provider/resolve', requireAuth, async (req, res) => {
  const body = req.body || {};
  const tmdbId = toInt(body.tmdb_id, { min: 1 });
  const mediaType = body.media_type === 'movie' || body.media_type === 'tv'
    ? body.media_type
    : null;
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const releaseDate = typeof body.release_date === 'string' ? body.release_date : null;

  if (!tmdbId || !mediaType || !title) {
    return res.status(400).json({ error: 'invalid_params' });
  }

  try {
    const resolved = await resolveProviderTitle({
      tmdbId,
      mediaType,
      title,
      releaseDate
    });

    return res.json({ resolved });
  } catch (error) {
    console.error('[provider/resolve]', error);
    return res.status(500).json({ error: 'provider_resolve_failed' });
  }
});

export default router;
