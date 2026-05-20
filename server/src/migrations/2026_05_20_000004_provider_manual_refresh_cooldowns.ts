import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS provider_manual_refresh_cooldowns (
      tmdb_id BIGINT NOT NULL,
      media_type VARCHAR NOT NULL,
      provider VARCHAR NOT NULL,
      last_manual_refresh_at BIGINT NOT NULL,
      PRIMARY KEY (tmdb_id, media_type, provider)
    )
  `.execute(db);

  await sql`
    INSERT INTO provider_manual_refresh_cooldowns (tmdb_id, media_type, provider, last_manual_refresh_at)
    SELECT tmdb_id, media_type, provider, last_manual_refresh_at
    FROM provider_title_map
    WHERE last_manual_refresh_at IS NOT NULL
    ON CONFLICT (tmdb_id, media_type, provider) DO NOTHING
  `.execute(db);

  await sql`
    ALTER TABLE provider_title_map DROP COLUMN IF EXISTS last_manual_refresh_at
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE provider_title_map ADD COLUMN IF NOT EXISTS last_manual_refresh_at BIGINT
  `.execute(db);

  await sql`
    UPDATE provider_title_map ptm
    SET last_manual_refresh_at = pmc.last_manual_refresh_at
    FROM provider_manual_refresh_cooldowns pmc
    WHERE ptm.tmdb_id = pmc.tmdb_id
      AND ptm.media_type = pmc.media_type
      AND ptm.provider = pmc.provider
  `.execute(db);

  await sql`
    DROP TABLE IF EXISTS provider_manual_refresh_cooldowns
  `.execute(db);
}
