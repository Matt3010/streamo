// Shared types used by both frontend (Angular) and backend (Express).
// Wire-format only — no UI-specific shapes (those stay in frontend/src/app/models).

export type MediaType = 'movie' | 'tv';
export type WatchlistStatus = 'todo' | 'done';

export interface User {
  id: number;
  email: string;
  autoplay_next: 0 | 1;
  is_admin?: boolean;
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
  /** Episodes that have already aired (sum across seasons up to and
   * including last_episode_to_air). Differs from total_episodes for
   * shows still releasing. Falls back to total_episodes when TMDB
   * doesn't expose air data. */
  aired_episodes?: number;
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

// Admin types

export interface AdminUserRow {
  id: number;
  email: string;
  created_at: number;
  token: string | null;
  label: string | null;
  token_created_at: number | null;
  used_at: number | null;
  revoked_at: number | null;
}

export interface AdminTokenRow {
  token: string;
  label: string | null;
  created_at: number;
  used_at: number | null;
  revoked_at: number | null;
  used_by_email: string | null;
}

export interface AdminSession {
  user_id: number;
  email: string;
  tmdb_id: number;
  media_type: MediaType;
  season: number;
  episode: number;
  position: number;
  duration: number;
  title: string | null;
  poster: string | null;
  updated_at: number;
}
