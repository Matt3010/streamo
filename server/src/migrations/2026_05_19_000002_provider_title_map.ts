import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS provider_title_map (
      tmdb_id INTEGER NOT NULL,
      media_type TEXT NOT NULL,
      provider TEXT NOT NULL,
      provider_id INTEGER,
      provider_slug TEXT,
      match_status TEXT NOT NULL DEFAULT 'failed',
      match_confidence INTEGER NOT NULL DEFAULT 0,
      source_title TEXT NOT NULL,
      resolved_title TEXT,
      release_year INTEGER,
      failure_reason TEXT,
      resolved_at BIGINT,
      last_checked_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
      PRIMARY KEY (tmdb_id, media_type, provider)
    )
  `.execute(db);

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_title_map_provider_target
    ON provider_title_map(provider, media_type, provider_id)
    WHERE provider_id IS NOT NULL
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS provider_title_map`.execute(db);
}
