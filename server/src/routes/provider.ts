import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { toInt } from '../utils/validation';
import { resolveProviderEpisode, resolveProviderMovie, resolveProviderTitle } from '../services/provider-resolver';

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

router.post('/user/provider/resolve-episode', requireAuth, async (req, res) => {
  const body = req.body || {};
  const providerTitleId = toInt(body.provider_title_id, { min: 1 });
  const seasonNumber = toInt(body.season, { min: 1 });
  const episodeNumber = toInt(body.episode, { min: 1 });
  const providerSlug = typeof body.provider_slug === 'string' && body.provider_slug.trim()
    ? body.provider_slug.trim()
    : null;

  if (!providerTitleId || !seasonNumber || !episodeNumber) {
    return res.status(400).json({ error: 'invalid_params' });
  }

  try {
    const resolved = await resolveProviderEpisode({
      providerTitleId,
      providerSlug,
      seasonNumber,
      episodeNumber
    });

    return res.json({ resolved });
  } catch (error) {
    console.error('[provider/resolve-episode]', error);
    return res.status(500).json({ error: 'provider_episode_resolve_failed' });
  }
});

router.post('/user/provider/resolve-movie', requireAuth, async (req, res) => {
  const body = req.body || {};
  const providerTitleId = toInt(body.provider_title_id, { min: 1 });

  if (!providerTitleId) {
    return res.status(400).json({ error: 'invalid_params' });
  }

  try {
    const resolved = await resolveProviderMovie({
      providerTitleId
    });

    return res.json({ resolved });
  } catch (error) {
    console.error('[provider/resolve-movie]', error);
    return res.status(500).json({ error: 'provider_movie_resolve_failed' });
  }
});

export default router;
