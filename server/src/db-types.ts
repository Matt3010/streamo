import type { ColumnType, Generated } from 'kysely';

// Unix-epoch seconds, stored as BIGINT in PG. Kysely returns BIGINT as
// string by default, but our app code treats updated_at/created_at as
// numbers — we configure node-pg in db.ts to parse INT8 as number, so
// `number` is correct here at the type level.
type Epoch = number;

interface UsersTable {
  id: Generated<number>;
  email: string;
  password_hash: string;
  autoplay_next: ColumnType<0 | 1, 0 | 1 | undefined, 0 | 1>;
  folders_enabled: ColumnType<0 | 1, 0 | 1 | undefined, 0 | 1>;
  notif_new_episode: ColumnType<0 | 1, 0 | 1 | undefined, 0 | 1>;
  notif_new_season: ColumnType<0 | 1, 0 | 1 | undefined, 0 | 1>;
  notif_resume_reminder: ColumnType<0 | 1, 0 | 1 | undefined, 0 | 1>;
  background_pattern_data_url: ColumnType<string | null, string | null | undefined, string | null>;
  created_at: ColumnType<Epoch, Epoch | undefined, Epoch>;
}

interface NotificationsTable {
  id: Generated<number>;
  user_id: number;
  type: ColumnType<
    'new_episode' | 'new_season' | 'resume_reminder' | 'series_completed' | 'admin_alert',
    'new_episode' | 'new_season' | 'resume_reminder' | 'series_completed' | 'admin_alert',
    'new_episode' | 'new_season' | 'resume_reminder' | 'series_completed' | 'admin_alert'
  >;
  tmdb_id: number;
  media_type: string;
  title: string | null;
  poster: string | null;
  payload_json: ColumnType<string, string | undefined, string>;
  created_at: ColumnType<Epoch, Epoch | undefined, Epoch>;
  read_at: Epoch | null;
}

interface FcmTokensTable {
  token: string;
  user_id: number;
  user_agent: string | null;
  created_at: ColumnType<Epoch, Epoch | undefined, Epoch>;
  last_seen_at: ColumnType<Epoch, Epoch | undefined, Epoch>;
}

interface ProgressTable {
  user_id: number;
  tmdb_id: number;
  media_type: string;
  season: ColumnType<number, number | undefined, number>;
  episode: ColumnType<number, number | undefined, number>;
  position: number;
  duration: ColumnType<number, number | undefined, number>;
  synthetic: ColumnType<0 | 1, 0 | 1 | undefined, 0 | 1>;
  title: string | null;
  poster: string | null;
  backdrop: string | null;
  updated_at: ColumnType<Epoch, Epoch | undefined, Epoch>;
}

interface HiddenContinueTable {
  user_id: number;
  tmdb_id: number;
  media_type: string;
  hidden_at: ColumnType<Epoch, Epoch | undefined, Epoch>;
}

interface HistoryTable {
  id: Generated<number>;
  user_id: number;
  tmdb_id: number;
  media_type: string;
  season: ColumnType<number, number | undefined, number>;
  episode: ColumnType<number, number | undefined, number>;
  title: string | null;
  poster: string | null;
  watched_at: ColumnType<Epoch, Epoch | undefined, Epoch>;
}

interface WatchlistTable {
  user_id: number;
  tmdb_id: number;
  media_type: string;
  title: string | null;
  poster: string | null;
  status: ColumnType<'todo' | 'in_progress' | 'done', 'todo' | 'in_progress' | 'done' | undefined, 'todo' | 'in_progress' | 'done'>;
  folder_name: string | null;
  done_aired_episodes: ColumnType<number, number | undefined, number>;
  added_at: ColumnType<Epoch, Epoch | undefined, Epoch>;
}

interface MetaTable {
  key: string;
  value: string;
}

interface TmdbCacheTable {
  cache_key: string;
  data: string;
  fetched_at: ColumnType<Epoch, Epoch | undefined, Epoch>;
}

interface ProviderTitleMapTable {
  tmdb_id: number;
  media_type: string;
  provider: string;
  provider_id: number | null;
  provider_slug: string | null;
  match_status: string;
  match_confidence: ColumnType<number, number | undefined, number>;
  source_title: string;
  resolved_title: string | null;
  release_year: number | null;
  failure_reason: string | null;
  resolved_at: Epoch | null;
  last_checked_at: ColumnType<Epoch, Epoch | undefined, Epoch>;
  candidates_json: string | null;
}

interface ProviderManualRefreshCooldownsTable {
  tmdb_id: number;
  media_type: string;
  provider: string;
  last_manual_refresh_at: Epoch;
}

export interface Database {
  users: UsersTable;
  progress: ProgressTable;
  hidden_continue: HiddenContinueTable;
  history: HistoryTable;
  watchlist: WatchlistTable;
  _meta: MetaTable;
  tmdb_cache: TmdbCacheTable;
  provider_title_map: ProviderTitleMapTable;
  provider_manual_refresh_cooldowns: ProviderManualRefreshCooldownsTable;
  notifications: NotificationsTable;
  fcm_tokens: FcmTokensTable;
}
