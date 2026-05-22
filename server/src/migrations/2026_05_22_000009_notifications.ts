import { Kysely, sql } from 'kysely';

/* In-app notifications inbox plus the device-token table that PR 3 will
 * use for FCM web push. The inbox is delivered live over WebSocket and
 * persisted here so we can still show history even when the user has
 * denied browser notification permission.
 *
 * Three new boolean prefs on `users` let the user opt out of each
 * notification class without disabling push entirely. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      tmdb_id INTEGER NOT NULL,
      media_type TEXT NOT NULL,
      title TEXT,
      poster TEXT,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
      read_at BIGINT
    )
  `.execute(db);

  await sql`ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_chk`.execute(db);
  await sql`ALTER TABLE notifications ADD CONSTRAINT notifications_type_chk CHECK (type IN ('new_episode', 'new_season', 'resume_reminder'))`.execute(db);
  await sql`ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_media_type_chk`.execute(db);
  await sql`ALTER TABLE notifications ADD CONSTRAINT notifications_media_type_chk CHECK (media_type IN ('movie', 'tv'))`.execute(db);

  await sql`CREATE INDEX IF NOT EXISTS idx_notifications_user_time ON notifications(user_id, created_at DESC)`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id) WHERE read_at IS NULL`.execute(db);
  // Supports the createNotification() dedupe lookup: filter by
  // (user_id, type, tmdb_id) and pick the most recent row to compare
  // payload + created_at against the 7-day window.
  await sql`CREATE INDEX IF NOT EXISTS idx_notifications_dedupe ON notifications(user_id, type, tmdb_id, created_at DESC)`.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS fcm_tokens (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_agent TEXT,
      created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
      last_seen_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
    )
  `.execute(db);

  await sql`CREATE INDEX IF NOT EXISTS idx_fcm_tokens_user ON fcm_tokens(user_id)`.execute(db);

  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS notif_new_episode INTEGER NOT NULL DEFAULT 1`.execute(db);
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS notif_new_season INTEGER NOT NULL DEFAULT 1`.execute(db);
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS notif_resume_reminder INTEGER NOT NULL DEFAULT 1`.execute(db);

  await sql`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_notif_new_episode_bool`.execute(db);
  await sql`ALTER TABLE users ADD CONSTRAINT users_notif_new_episode_bool CHECK (notif_new_episode IN (0, 1))`.execute(db);
  await sql`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_notif_new_season_bool`.execute(db);
  await sql`ALTER TABLE users ADD CONSTRAINT users_notif_new_season_bool CHECK (notif_new_season IN (0, 1))`.execute(db);
  await sql`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_notif_resume_reminder_bool`.execute(db);
  await sql`ALTER TABLE users ADD CONSTRAINT users_notif_resume_reminder_bool CHECK (notif_resume_reminder IN (0, 1))`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_notif_resume_reminder_bool`.execute(db);
  await sql`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_notif_new_season_bool`.execute(db);
  await sql`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_notif_new_episode_bool`.execute(db);
  await sql`ALTER TABLE users DROP COLUMN IF EXISTS notif_resume_reminder`.execute(db);
  await sql`ALTER TABLE users DROP COLUMN IF EXISTS notif_new_season`.execute(db);
  await sql`ALTER TABLE users DROP COLUMN IF EXISTS notif_new_episode`.execute(db);
  await sql`DROP INDEX IF EXISTS idx_fcm_tokens_user`.execute(db);
  await sql`DROP TABLE IF EXISTS fcm_tokens`.execute(db);
  await sql`DROP INDEX IF EXISTS idx_notifications_dedupe`.execute(db);
  await sql`DROP INDEX IF EXISTS idx_notifications_user_unread`.execute(db);
  await sql`DROP INDEX IF EXISTS idx_notifications_user_time`.execute(db);
  await sql`DROP TABLE IF EXISTS notifications`.execute(db);
}
