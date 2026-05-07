import type { MediaType } from './media.model';

export type WatchlistStatus = 'todo' | 'done';

export interface WatchlistItem {
  tmdb_id: number;
  media_type: MediaType;
  title: string | null;
  poster: string | null;
  status: WatchlistStatus;
  added_at: number;
  // TV-only enrichment (server-side join with progress + TMDB cache).
  last_season?: number;
  last_episode?: number;
  watched_count?: number;
  total_seasons?: number;
  total_episodes?: number;
  seasons?: Array<{ season_number: number; episode_count: number }>;
  // Latest in-flight progress (movies + TV) — drives the card progress bar.
  position?: number;
  duration?: number;
}
