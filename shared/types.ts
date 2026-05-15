// Shared types used by both frontend (Angular) and backend (Express).
// Wire-format only — no UI-specific shapes (those stay in frontend/src/app/models).

export type MediaType = 'movie' | 'tv';
export type WatchlistStatus = 'todo' | 'in_progress' | 'done';
export type WatchlistListStatusFilter = WatchlistStatus | 'unreleased';

export interface User {
  id: number;
  email: string;
  autoplay_next: 0 | 1;
  folders_enabled: 0 | 1;
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
  position?: number;
  duration?: number;
  completed?: boolean;
  watch_status_text?: string;
  resume_text?: string;
  resume_season?: number;
  resume_episode?: number;
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
  folder_name?: string | null;
  added_at: number;
  /** For TV rows manually marked as done: number of aired episodes at the
   * moment the user marked the show "Visto". Lets new releases flip back to
   * todo without falsifying real playback progress. */
  done_aired_episodes?: number;
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
  watch_status_text?: string;
  next_release_text?: string;
  is_upcoming?: boolean;
  caught_up?: boolean;
  // Where the watch page should resume — already pivoted past finished
  // episodes by the backend. Lets the card click navigate straight to the
  // right (s, e) without an extra fetch.
  resume_season?: number;
  resume_episode?: number;
  // Latest in-flight progress, drives the card progress bar
  position?: number;
  duration?: number;
}

export interface WatchlistUpdatedEvent {
  type: 'watchlist-updated';
  reason: 'watchlist-changed' | 'folder-changed' | 'new-episode';
  tmdb_id?: number;
  media_type?: MediaType;
}

// Share-link types

export type ShareLinkStatus = 'active' | 'suspended';

export interface ShareLink {
  id: number;
  token: string;
  label: string | null;
  status: ShareLinkStatus;
  created_at: number;
}

/* Public read-only view of someone's watchlist. Items are the raw DB
 * rows (no per-user progress enrichment) — the consuming UI is
 * read-only so server-side resume / next-episode hints are
 * irrelevant. */
export interface SharedWatchlistResponse {
  owner: { name: string };
  items: SharedWatchlistItem[];
}

export interface SharedWatchlistItem {
  tmdb_id: number;
  media_type: MediaType;
  title: string | null;
  poster: string | null;
  status: WatchlistStatus;
  folder_name: string | null;
  done_aired_episodes: number;
  added_at: number;
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
  can_manage?: boolean;
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

export interface PlaybackLogEntry {
  ts: number;
  message: string;
}

export interface TransportLogEntry {
  ts: string;
  kind: string;
  request_uri: string;
  status: number;
  upstream_status: string;
  upstream_host: string;
  request_time: number;
  upstream_response_time: string;
}

export interface AdminQueueWorkerHeartbeat {
  key: string;
  worker_id: string;
  pid: number;
  hostname: string;
  started_at: number;
  last_seen_at: number;
  ttl_seconds: number;
}

export interface AdminQueueStatus {
  redis_configured: boolean;
  queue_available: boolean;
  scheduler_enabled: boolean;
  counts: {
    waiting: number;
    active: number;
    delayed: number;
    completed: number;
    failed: number;
    paused: number;
  };
  workers: AdminQueueWorkerHeartbeat[];
}
