import type { WatchlistItem } from '../models';

/**
 * Computes the small status text shown on watchlist cards (in the watchlist
 * page and the home preview row). "Mancano N episodi" is measured from the
 * user's *current position* (last touched season/episode), not from a count
 * of how many rows crossed the watched threshold — so it stays consistent
 * with the Continue watching card and the player's resume point even if the
 * user jumped ahead in seasons.
 */
export function computeWatchStatus(w: WatchlistItem): string {
  if (w.media_type !== 'tv') return '';
  // Prefer aired episodes so ongoing series count only what's been released,
  // not future-scheduled ones. Falls back to total when the backend hasn't
  // populated aired (older cache, missing TMDB data).
  const airedEp = w.aired_episodes ?? w.total_episodes ?? 0;
  if (airedEp === 0) return ''; // TMDB data missing — say nothing

  // watched_count tracks episodes that crossed the WATCHED_THRESHOLD (≥80%).
  // Using "max episode touched" instead would overcount: just opening the
  // latest episode for a few seconds would falsely flip the badge to
  // "Sei al passo" even though that episode isn't finished.
  const watched = w.watched_count ?? 0;
  if (watched === 0) return ''; // Not started — no badge.

  const remaining = Math.max(0, airedEp - watched);
  if (remaining === 0) return 'Sei al passo';
  return remaining === 1 ? 'Manca 1 episodio' : `Mancano ${remaining} episodi`;
}
