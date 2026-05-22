// Shared types used by both frontend (Angular) and backend (Express).
// Wire-format only — no UI-specific shapes (those stay in frontend/src/app/models).

export type MediaType = 'movie' | 'tv';

/** Reason for a failed provider resolve. Shared so server (resolver
 *  outcome) and client (player / provider-resolve service) agree on
 *  the wire-format strings — they were declared three times before. */
export type ProviderResolveFailureReason = 'not_found' | 'temporarily_unavailable' | 'unreleased';
export type WatchlistStatus = 'todo' | 'in_progress' | 'done';
export type WatchlistListStatusFilter = WatchlistStatus | 'unreleased';

export interface User {
  id: number;
  email: string;
  autoplay_next: 0 | 1;
  folders_enabled: 0 | 1;
  notif_new_episode: 0 | 1;
  notif_new_season: 0 | 1;
  notif_resume_reminder: 0 | 1;
  is_admin?: boolean;
}

export type NotificationType =
  | 'new_episode'
  | 'new_season'
  | 'resume_reminder'
  | 'series_completed'
  | 'admin_alert';

export type AdminAlertKind = 'worker' | 'failed_jobs' | 'egress' | 'provider' | 'fcm_credentials';

export interface NotificationPayload {
  season?: number;
  episode?: number;
  aired_delta?: number;
  /** Frozen random index used by formatNotificationBody to pick a phrase
   *  from a pool (e.g. for series_completed). Frozen at create time so
   *  reopening the bell shows the same line every time. */
  flavor_index?: number;
  /** Discriminator for `admin_alert`. */
  kind?: AdminAlertKind;
  /** Free-form context shown in the notification body (e.g. queue name,
   *  failure count). */
  detail?: string;
}


export interface NotificationItem {
  id: number;
  type: NotificationType;
  tmdb_id: number;
  media_type: MediaType;
  title: string | null;
  poster: string | null;
  payload: NotificationPayload;
  created_at: number;
  read_at: number | null;
}

export interface NotificationCreatedEvent {
  type: 'notification-created';
  notification: NotificationItem;
}

export interface NotificationListResponse {
  items: NotificationItem[];
  unread_count: number;
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
  watch_status_text?: string;
  next_release_text?: string;
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

// Admin types

export interface PlaybackLogEntry {
  ts: number;
  message: string;
}

export interface AuthLogEntry {
  ts: number;
  message: string;
}

export interface ProviderResolveLogEntry {
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
  denied_by: string;
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

export interface AdminQueueCounts {
  waiting: number;
  active: number;
  delayed: number;
  completed: number;
  failed: number;
  paused: number;
}

export interface AdminQueueSnapshot {
  name: string;
  available: boolean;
  counts: AdminQueueCounts;
}

export interface AdminQueueStatus {
  redis_configured: boolean;
  scheduler_enabled: boolean;
  queues: AdminQueueSnapshot[];
  workers: AdminQueueWorkerHeartbeat[];
  // Rolling 5-minute provider outage flag — true when temporarily_unavailable
  // events have crossed the threshold in the recent window. Drives the
  // "Provider" pill on the admin queue tab.
  provider_outage: boolean;
  // Cached result of the latest admin-health egress probe (every 5 min).
  // Defaults to true on a fresh boot before any probe has run, so the
  // pill doesn't false-alarm.
  egress_ok: boolean;
}

// Backend egress probe — verifies that outbound traffic is exiting via
// the WARP tunnel. Fetched on demand from the admin "Egress" tab.
export interface AdminEgressCheck {
  checked_at: number;
  ip: string | null;
  asn_org: string | null;
  warp: boolean;
  colo: string | null;
  country: string | null;
  city: string | null;
  through_cloudflare: boolean;
  errors: string[];
}
