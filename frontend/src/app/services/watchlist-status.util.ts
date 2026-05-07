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
  const totalEp = w.total_episodes ?? 0;
  if (totalEp === 0) return ''; // TMDB data missing — say nothing

  const lastSeason = w.last_season ?? 0;
  const lastEpisode = w.last_episode ?? 0;
  // Not started — let the user use manual input (no badge).
  if (lastSeason === 0 || lastEpisode === 0) return '';

  // Linear episode index of the current play position: every episode in
  // earlier seasons + the current episode in the current season.
  const seasons = w.seasons ?? [];
  const before = seasons
    .filter(s => s.season_number < lastSeason)
    .reduce((sum, s) => sum + (s.episode_count || 0), 0);
  const watchedSoFar = before + lastEpisode;
  const remaining = Math.max(0, totalEp - watchedSoFar);

  if (remaining === 0) return 'Sei al passo';
  return remaining === 1 ? 'Manca 1 episodio' : `Mancano ${remaining} episodi`;
}
