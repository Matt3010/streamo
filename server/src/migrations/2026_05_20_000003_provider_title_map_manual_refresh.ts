import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE provider_title_map
    ADD COLUMN IF NOT EXISTS last_manual_refresh_at BIGINT
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE provider_title_map
    DROP COLUMN IF EXISTS last_manual_refresh_at
  `.execute(db);
}
