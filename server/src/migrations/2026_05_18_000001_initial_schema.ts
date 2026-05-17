import { Kysely, sql } from 'kysely';

/* Initial schema. Idempotent (CREATE ... IF NOT EXISTS) so existing
 * deployments — which were created from the legacy db-schema.sql — can
 * register this migration as already applied without redoing the work. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`CREATE EXTENSION IF NOT EXISTS citext`.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email CITEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      autoplay_next INTEGER NOT NULL DEFAULT 1,
      folders_enabled INTEGER NOT NULL DEFAULT 1,
      created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
    )
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS progress (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tmdb_id INTEGER NOT NULL,
      media_type TEXT NOT NULL,
      season INTEGER NOT NULL DEFAULT 0,
      episode INTEGER NOT NULL DEFAULT 0,
      position DOUBLE PRECISION NOT NULL,
      duration DOUBLE PRECISION NOT NULL DEFAULT 0,
      synthetic INTEGER NOT NULL DEFAULT 0,
      title TEXT,
      poster TEXT,
      backdrop TEXT,
      updated_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
      PRIMARY KEY (user_id, tmdb_id, media_type, season, episode)
    )
  `.execute(db);

  await sql`CREATE INDEX IF NOT EXISTS idx_progress_user_updated ON progress(user_id, updated_at DESC)`.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS hidden_continue (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tmdb_id INTEGER NOT NULL,
      media_type TEXT NOT NULL,
      hidden_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
      PRIMARY KEY (user_id, tmdb_id, media_type)
    )
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS history (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tmdb_id INTEGER NOT NULL,
      media_type TEXT NOT NULL,
      season INTEGER NOT NULL DEFAULT 0,
      episode INTEGER NOT NULL DEFAULT 0,
      title TEXT,
      poster TEXT,
      watched_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
    )
  `.execute(db);

  await sql`CREATE INDEX IF NOT EXISTS idx_history_user_time ON history(user_id, watched_at DESC)`.execute(db);
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_history_unique ON history(user_id, tmdb_id, media_type, season, episode)`.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS watchlist (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tmdb_id INTEGER NOT NULL,
      media_type TEXT NOT NULL,
      title TEXT,
      poster TEXT,
      status TEXT NOT NULL DEFAULT 'todo',
      folder_name TEXT,
      done_aired_episodes INTEGER NOT NULL DEFAULT 0,
      added_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
      PRIMARY KEY (user_id, tmdb_id, media_type)
    )
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS _meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS tmdb_cache (
      cache_key TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      fetched_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
    )
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS invite_tokens (
      token TEXT PRIMARY KEY,
      label TEXT,
      created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
      used_at BIGINT,
      used_by_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      revoked_at BIGINT
    )
  `.execute(db);

  await sql`CREATE INDEX IF NOT EXISTS idx_invite_used_by ON invite_tokens(used_by_user_id)`.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS share_links (
      id SERIAL PRIMARY KEY,
      token TEXT UNIQUE NOT NULL,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      label TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      view_count INTEGER NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
    )
  `.execute(db);

  await sql`CREATE INDEX IF NOT EXISTS idx_share_links_user ON share_links(user_id)`.execute(db);
}

export async function down(_db: Kysely<unknown>): Promise<void> {
  throw new Error('refusing to drop the initial schema');
}
