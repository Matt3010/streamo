// Centralized constants and env-derived config.

export const PORT = Number(process.env.PORT) || 3000;
export const TOKEN_TTL = 60 * 60 * 24 * 30; // 30 days
export const COOKIE_SECURE =
  process.env.COOKIE_SECURE === '1' || process.env.NODE_ENV === 'production';
export const TMDB_API_KEY = process.env.TMDB_API_KEY || '';
export const TMDB_CACHE_TTL = 6 * 60 * 60; // 6 hours
export const TMDB_REFRESH_INTERVAL_SECONDS = Number(process.env.TMDB_REFRESH_INTERVAL_SECONDS) || (30 * 60);
export const REDIS_URL = (process.env.REDIS_URL || '').trim();
export const WORKER_CONCURRENCY = Math.max(1, Number(process.env.WORKER_CONCURRENCY) || 4);
export const TMDB_JOB_RATE_LIMIT_MAX = Math.max(1, Number(process.env.TMDB_JOB_RATE_LIMIT_MAX) || 6);
export const TMDB_JOB_RATE_LIMIT_DURATION_MS = Math.max(100, Number(process.env.TMDB_JOB_RATE_LIMIT_DURATION_MS) || 1000);
export const PROVIDER_CATALOG_BASE_URL_OVERRIDE = (
  process.env.PROVIDER_CATALOG_BASE_URL_OVERRIDE ||
  process.env.PROVIDER_CATALOG_BASE_URL ||
  ''
).trim();
export const PROVIDER_CATALOG_LINK_SOURCE_URL =
  'https://api.telegra.ph/getPage/Link-Aggiornato-StreamingCommunity-09-29?return_content=true';
export const PROVIDER_CATALOG_LOCALE = (process.env.PROVIDER_CATALOG_LOCALE || 'it').trim() || 'it';
export const PROVIDER_RESOLVE_CACHE_TTL = Math.max(60, Number(process.env.PROVIDER_RESOLVE_CACHE_TTL) || (6 * 60 * 60));
export const PROVIDER_RESOLVER_DEBUG = process.env.PROVIDER_RESOLVER_DEBUG !== '0';
export const PROVIDER_LINK_SOURCE_CACHE_TTL_SECONDS = Math.max(
  60,
  Number(process.env.PROVIDER_LINK_SOURCE_CACHE_TTL_SECONDS) || (10 * 60)
);

// Episodes/movies count as "watched" once you've seen at least this fraction.
export const WATCHED_THRESHOLD = 0.8;
// "Continua a guardare" hides items only when they're effectively complete —
// otherwise pausing at 80% to grab a coffee would yank the title out of your
// resume queue.
export const CONTINUE_HIDE_THRESHOLD = 0.95;

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const SUPER_ADMIN_EMAIL = (process.env.SUPER_ADMIN_EMAIL || '').trim().toLowerCase();
