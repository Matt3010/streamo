import { Router, type Request, type Response } from 'express';
import { authenticateToken, respondAuthFailure } from '../middleware/auth';
import { providerResolveLogger } from '../services/provider-resolve-logs';
import { toInt } from '../utils/validation';
import { manuallyConfirmProviderTitle, refreshProviderTitle, resolveProviderEpisode, resolveProviderMovie, resolveProviderTitle } from '../services/provider-resolver';

const router = Router();

router.post('/user/provider/resolve', async (req, res) => {
  const authed = await authorizeProviderRequest(req, res, 'route resolve auth denied');
  if (!authed) return;

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

    return res.json(resolved);
  } catch (error) {
    providerResolveLogger.error('route resolve failed', {
      user: req.user?.email ?? '-',
      tmdbId,
      mediaType,
      title,
      releaseDate
    });
    console.error('[provider/resolve]', error);
    return res.status(500).json({ error: 'provider_resolve_failed' });
  }
});

router.post('/user/provider/refresh-resolve', async (req, res) => {
  const authed = await authorizeProviderRequest(req, res, 'route refresh resolve auth denied');
  if (!authed) return;

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
    const resolved = await refreshProviderTitle({
      tmdbId,
      mediaType,
      title,
      releaseDate
    });

    return res.json(resolved);
  } catch (error) {
    providerResolveLogger.error('route refresh resolve failed', {
      user: req.user?.email ?? '-',
      tmdbId,
      mediaType,
      title,
      releaseDate
    });
    console.error('[provider/refresh-resolve]', error);
    return res.status(500).json({ error: 'provider_refresh_resolve_failed' });
  }
});

router.post('/user/provider/manual-confirm', async (req, res) => {
  const authed = await authorizeProviderRequest(req, res, 'route manual confirm auth denied');
  if (!authed) return;

  const body = req.body || {};
  const tmdbId = toInt(body.tmdb_id, { min: 1 });
  const mediaType = body.media_type === 'movie' || body.media_type === 'tv'
    ? body.media_type
    : null;
  const providerTitleId = toInt(body.provider_title_id, { min: 1 });

  if (!tmdbId || !mediaType || !providerTitleId) {
    return res.status(400).json({ error: 'invalid_params' });
  }

  try {
    const resolved = await manuallyConfirmProviderTitle({
      tmdbId,
      mediaType,
      providerTitleId
    });
    return res.json(resolved);
  } catch (error) {
    providerResolveLogger.error('route manual confirm failed', {
      user: req.user?.email ?? '-',
      tmdbId,
      mediaType,
      providerTitleId
    });
    console.error('[provider/manual-confirm]', error);
    return res.status(500).json({ error: 'provider_manual_confirm_failed' });
  }
});

router.post('/user/provider/resolve-episode', async (req, res) => {
  const authed = await authorizeProviderRequest(req, res, 'route resolve episode auth denied');
  if (!authed) return;

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

    return res.json(resolved);
  } catch (error) {
    providerResolveLogger.error('route resolve episode failed', {
      user: req.user?.email ?? '-',
      providerTitleId,
      providerSlug,
      seasonNumber,
      episodeNumber
    });
    console.error('[provider/resolve-episode]', error);
    return res.status(500).json({ error: 'provider_episode_resolve_failed' });
  }
});

router.post('/user/provider/resolve-movie', async (req, res) => {
  const authed = await authorizeProviderRequest(req, res, 'route resolve movie auth denied');
  if (!authed) return;

  const body = req.body || {};
  const providerTitleId = toInt(body.provider_title_id, { min: 1 });

  if (!providerTitleId) {
    return res.status(400).json({ error: 'invalid_params' });
  }

  try {
    const resolved = await resolveProviderMovie({
      providerTitleId
    });

    return res.json(resolved);
  } catch (error) {
    providerResolveLogger.error('route resolve movie failed', {
      user: req.user?.email ?? '-',
      providerTitleId
    });
    console.error('[provider/resolve-movie]', error);
    return res.status(500).json({ error: 'provider_movie_resolve_failed' });
  }
});

async function authorizeProviderRequest(req: Request, res: Response, event: string): Promise<boolean> {
  const result = await authenticateToken(req.cookies?.token);
  if (!result.user) {
    providerResolveLogger.warn(event, {
      reason: result.error ?? 'unauthenticated',
      requestUri: req.originalUrl || req.url,
      ip: req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '-'
    });
    respondAuthFailure(req, res, result.error ?? 'unauthenticated', 'provider request auth denied');
    return false;
  }

  req.user = result.user;
  return true;
}

export default router;
