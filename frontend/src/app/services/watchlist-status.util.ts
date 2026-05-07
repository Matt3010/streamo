import type { WatchlistItem } from '../models';

/**
 * Computes the small status text shown on watchlist cards (in the watchlist
 * page and the home preview row). Uses only the enriched fields the backend
 * already returns — no extra fetches needed.
 */
export function computeWatchStatus(w: WatchlistItem): string {
  if (w.media_type !== 'tv') return '';
  const totalEp = w.total_episodes ?? 0;
  const watched = w.watched_count ?? 0;

  if (totalEp === 0) return ''; // TMDB data missing — say nothing
  if (watched === 0) return ''; // not started — let the user use manual input
  if (watched >= totalEp) return 'Sei al passo';

  const remaining = totalEp - watched;
  return remaining === 1 ? 'Manca 1 episodio' : `Mancano ${remaining} episodi`;
}
