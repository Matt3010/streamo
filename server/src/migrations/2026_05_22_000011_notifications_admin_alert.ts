import { Kysely, sql } from 'kysely';

/* Extend the notifications.type allowlist to include 'admin_alert' —
 * used for operator-side health pings (worker stuck, egress down,
 * provider outage, FCM credentials invalid). Targeted at the
 * super-admin user; reuses the user notifications pipeline
 * (inbox + WS + FCM) instead of a separate channel. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_chk`.execute(db);
  await sql`
    ALTER TABLE notifications
    ADD CONSTRAINT notifications_type_chk
    CHECK (type IN ('new_episode', 'new_season', 'resume_reminder', 'series_completed', 'admin_alert'))
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_chk`.execute(db);
  await sql`
    ALTER TABLE notifications
    ADD CONSTRAINT notifications_type_chk
    CHECK (type IN ('new_episode', 'new_season', 'resume_reminder', 'series_completed'))
  `.execute(db);
}
