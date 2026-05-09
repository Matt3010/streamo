import type { WatchlistItem } from '../models';

/**
 * Computes the small status text shown on watchlist cards (in the watchlist
 * page and the home preview row):
 * - TV: remaining aired episodes.
 * - Movie: remaining playback time.
 */
export function computeWatchStatus(w: WatchlistItem): string {
  if (w.media_type === 'movie') {
    return computeMovieRemaining(w);
  }

  // Prefer aired episodes so ongoing series count only what's been released,
  // not future-scheduled ones. Falls back to total when the backend hasn't
  // populated aired (older cache, missing TMDB data).
  const airedEp = w.aired_episodes ?? w.total_episodes ?? 0;
  if (airedEp === 0) return ''; // TMDB data missing: say nothing.

  // watched_count tracks episodes actually watched to threshold. For items
  // manually marked as done, done_aired_episodes remembers the "caught up"
  // baseline without falsifying real playback progress.
  const watched = Math.max(w.watched_count ?? 0, w.done_aired_episodes ?? 0);
  if (watched === 0) return ''; // Not started: no badge.

  const remaining = Math.max(0, airedEp - watched);
  if (remaining === 0) return 'Sei al passo';
  return remaining === 1 ? 'Manca 1 episodio' : `Mancano ${remaining} episodi`;
}

function computeMovieRemaining(w: WatchlistItem): string {
  const position = w.position ?? 0;
  const duration = w.duration ?? 0;
  if (duration <= 0 || position <= 0 || position >= duration) return '';

  const remainingMinutes = Math.ceil((duration - position) / 60);
  if (remainingMinutes <= 0) return '';
  if (remainingMinutes < 60) {
    return remainingMinutes === 1 ? 'Manca 1 min' : `Mancano ${remainingMinutes} min`;
  }

  const hours = Math.floor(remainingMinutes / 60);
  const minutes = remainingMinutes % 60;
  const timeLeft = minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
  return hours === 1 && minutes === 0 ? `Manca ${timeLeft}` : `Mancano ${timeLeft}`;
}
