// Shared types used by both frontend (Angular) and backend (Express).
// Wire-format only — no UI-specific shapes (those stay in frontend/src/app/models).

export type MediaType = 'movie' | 'tv';
export type WatchlistStatus = 'todo' | 'done';

export interface User {
  id: number;
  email: string;
  autoplay_next: 0 | 1;
}

export interface ProgressItem {
  tmdb_id: number;
  media_type: MediaType;
  season: number;
  episode: number;
  position: number;
  duration: number;
  title: string | null;
  poster: string | null;
  backdrop: string | null;
  updated_at: number;
}

export interface HistoryItem {
  tmdb_id: number;
  media_type: MediaType;
  season: number;
  episode: number;
  title: string | null;
  poster: string | null;
  watched_at: number;
}

export interface WatchlistSeasonInfo {
  season_number: number;
  episode_count: number;
}

export interface WatchlistItem {
  tmdb_id: number;
  media_type: MediaType;
  title: string | null;
  poster: string | null;
  status: WatchlistStatus;
  added_at: number;
  // TV-only enrichment computed by the backend
  last_season?: number;
  last_episode?: number;
  watched_count?: number;
  total_seasons?: number;
  total_episodes?: number;
  seasons?: WatchlistSeasonInfo[];
  // Where the watch page should resume — already pivoted past finished
  // episodes by the backend. Lets the card click navigate straight to the
  // right (s, e) without an extra fetch.
  next_season?: number;
  next_episode?: number;
  // Latest in-flight progress, drives the card progress bar
  position?: number;
  duration?: number;
}
