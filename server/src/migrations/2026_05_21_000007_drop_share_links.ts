import { Kysely, sql } from 'kysely';

/* The share-link feature was removed. Drop the table and its supporting
 * objects. Use IF EXISTS so the migration is safe to run on deployments
 * that — for whatever reason — never had the table. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX IF EXISTS idx_share_links_user`.execute(db);
  await sql`DROP TABLE IF EXISTS share_links`.execute(db);
}

export async function down(_db: Kysely<unknown>): Promise<void> {
  throw new Error('refusing to recreate share_links — the feature was removed');
}
