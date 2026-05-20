import { Kysely, sql } from 'kysely';

/* Tighten domain integrity on existing tables:
 *   - CHECK constraints on the columns we treat as booleans / enums but
 *     stored as INTEGER/TEXT (no runtime guard against bad writes today)
 *   - one missing index for the watchlist refresh sync job, whose query
 *     filters by media_type — not a leading column in the PK so today's
 *     scan is sequential
 *   - normalize provider_manual_refresh_cooldowns.tmdb_id to INTEGER to
 *     match the rest of the schema (was BIGINT for no reason). Safe: TMDB
 *     IDs are 32-bit-clean.
 */
// Each constraint is DROP-then-ADD so re-running a partially-applied
// migration is safe. PostgreSQL has no `ADD CONSTRAINT IF NOT EXISTS`
// for CHECK constraints, so the drop-first idiom is the standard
// workaround.
async function addCheck(db: Kysely<unknown>, table: string, name: string, expr: string): Promise<void> {
  await sql.raw(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${name}`).execute(db);
  await sql.raw(`ALTER TABLE ${table} ADD CONSTRAINT ${name} CHECK (${expr})`).execute(db);
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await addCheck(db, 'users', 'users_autoplay_next_bool', 'autoplay_next IN (0, 1)');
  await addCheck(db, 'users', 'users_folders_enabled_bool', 'folders_enabled IN (0, 1)');
  await addCheck(db, 'progress', 'progress_synthetic_bool', 'synthetic IN (0, 1)');

  await addCheck(db, 'progress', 'progress_media_type_chk', "media_type IN ('movie', 'tv')");
  await addCheck(db, 'history', 'history_media_type_chk', "media_type IN ('movie', 'tv')");
  await addCheck(db, 'watchlist', 'watchlist_media_type_chk', "media_type IN ('movie', 'tv')");
  await addCheck(db, 'hidden_continue', 'hidden_continue_media_type_chk', "media_type IN ('movie', 'tv')");

  await addCheck(db, 'watchlist', 'watchlist_status_chk', "status IN ('todo', 'in_progress', 'done')");
  await addCheck(db, 'share_links', 'share_links_status_chk', "status IN ('active', 'suspended')");

  await sql`CREATE INDEX IF NOT EXISTS idx_watchlist_media_tmdb ON watchlist(media_type, tmdb_id)`.execute(db);

  await sql`ALTER TABLE provider_manual_refresh_cooldowns ALTER COLUMN tmdb_id TYPE INTEGER`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE provider_manual_refresh_cooldowns ALTER COLUMN tmdb_id TYPE BIGINT`.execute(db);
  await sql`DROP INDEX IF EXISTS idx_watchlist_media_tmdb`.execute(db);
  await sql`ALTER TABLE share_links DROP CONSTRAINT IF EXISTS share_links_status_chk`.execute(db);
  await sql`ALTER TABLE watchlist DROP CONSTRAINT IF EXISTS watchlist_status_chk`.execute(db);
  await sql`ALTER TABLE hidden_continue DROP CONSTRAINT IF EXISTS hidden_continue_media_type_chk`.execute(db);
  await sql`ALTER TABLE watchlist DROP CONSTRAINT IF EXISTS watchlist_media_type_chk`.execute(db);
  await sql`ALTER TABLE history DROP CONSTRAINT IF EXISTS history_media_type_chk`.execute(db);
  await sql`ALTER TABLE progress DROP CONSTRAINT IF EXISTS progress_media_type_chk`.execute(db);
  await sql`ALTER TABLE progress DROP CONSTRAINT IF EXISTS progress_synthetic_bool`.execute(db);
  await sql`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_folders_enabled_bool`.execute(db);
  await sql`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_autoplay_next_bool`.execute(db);
}
