// Centralized constants and env-derived config.

export const PORT = Number(process.env.PORT) || 3000;
export const TOKEN_TTL = 60 * 60 * 24 * 30; // 30 days
export const COOKIE_SECURE =
  process.env.COOKIE_SECURE === '1' || process.env.NODE_ENV === 'production';
export const TMDB_API_KEY = process.env.TMDB_API_KEY || '';
export const TMDB_CACHE_TTL = 6 * 60 * 60; // 6 hours
export const TMDB_REFRESH_INTERVAL_SECONDS = Number(process.env.TMDB_REFRESH_INTERVAL_SECONDS) || (30 * 60);

// Episodes/movies count as "watched" once you've seen at least this fraction.
export const WATCHED_THRESHOLD = 0.8;
// "Continua a guardare" hides items only when they're effectively complete —
// otherwise pausing at 80% to grab a coffee would yank the title out of your
// resume queue.
export const CONTINUE_HIDE_THRESHOLD = 0.95;

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const SUPER_ADMIN_EMAIL = (process.env.SUPER_ADMIN_EMAIL || '').trim().toLowerCase();
