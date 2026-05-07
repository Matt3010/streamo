import type { MediaType } from './media.model';
import type { WatchlistStatus } from './watchlist.model';

/**
 * Unified card data — used by every row in the app
 * (TMDB results, search, watchlist, continue watching, history view).
 *
 * Optional fields drive the visual variants:
 *   - position+duration → progress bar
 *   - season+episode    → "S1 E1" badge
 *   - year/rating       → meta line for TMDB items
 */
export interface CardItem {
  tmdb_id: number;
  media_type: MediaType;
  title: string;
  poster: string | null;
  year?: string;
  rating?: string;
  season?: number;
  episode?: number;
  position?: number;
  duration?: number;
  status?: WatchlistStatus;
  /** Optional secondary line (e.g. "Mancano 3 episodi" on the watchlist). */
  watchStatus?: string;
  /** TMDB total seasons — used as max in manual progress input. */
  totalSeasons?: number;
  /** User's last-watched season for this TV item (max from progress rows). */
  lastSeason?: number;
  /** User's last-watched episode within `lastSeason`. */
  lastEpisode?: number;
  /** Per-season episode counts — used to cap the episode input in the modal. */
  seasons?: Array<{ season_number: number; episode_count: number }>;
}
