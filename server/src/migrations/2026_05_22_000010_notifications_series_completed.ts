import { Kysely, sql } from 'kysely';

/* Add 'series_completed' to the notifications.type allowlist. The check
 * constraint in 000009 hardcoded the three then-existing types; this
 * one extends it. Drop-then-add is the standard idiom — PG has no
 * ADD CONSTRAINT IF NOT EXISTS for CHECK constraints. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_chk`.execute(db);
  await sql`
    ALTER TABLE notifications
    ADD CONSTRAINT notifications_type_chk
    CHECK (type IN ('new_episode', 'new_season', 'resume_reminder', 'series_completed'))
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_chk`.execute(db);
  await sql`
    ALTER TABLE notifications
    ADD CONSTRAINT notifications_type_chk
    CHECK (type IN ('new_episode', 'new_season', 'resume_reminder'))
  `.execute(db);
}
