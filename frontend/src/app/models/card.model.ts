import type { MediaType } from './media.model';
import type { WatchlistStatus } from './watchlist.model';

export type CardPendingAction = 'watchlist' | 'status' | 'remove' | 'folder';

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
  popularity?: number;
  voteCount?: number;
  year?: string;
  rating?: string;
  season?: number;
  episode?: number;
  position?: number;
  duration?: number;
  status?: WatchlistStatus;
  folderName?: string | null;
  inWatchlist?: boolean;
  isUpcoming?: boolean;
  upcomingBadge?: string;
  /** Optional secondary line (e.g. "Mancano 3 episodi" on the watchlist). */
  watchStatus?: string;
  /** Compact upcoming-release hint for watchlist/continue-monitoring cards. */
  nextReleaseText?: string;
  /** Pending mutation currently affecting this card's actions. */
  pendingAction?: CardPendingAction;
}
