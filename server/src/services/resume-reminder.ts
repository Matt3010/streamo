import { sql } from 'kysely';
import { kdb } from '../db';
import { createNotificationsForUsers, hasRecentNotificationOfType } from './notifications';
import type { MediaType } from '../../../shared/types';

// Idle window: at least 7 days since the last play position update, and at
// most 30 days. Older than 30 days we assume the user has moved on and a
// reminder is unwelcome spam.
const IDLE_MIN_SECONDS = 7 * 86400;
const IDLE_MAX_SECONDS = 30 * 86400;

// Suppression: once we've nudged a user about a given show, wait this long
// before nudging again (regardless of new progress activity).
const SUPPRESSION_WINDOW_SECONDS = 30 * 86400;

// Progress band that qualifies as "stalled mid-watch". Below 5% is barely
// started (unlikely to be intentional viewing), above 95% is effectively done.
const PROGRESS_MIN_FRACTION = 0.05;
const PROGRESS_MAX_FRACTION = 0.95;

interface CandidateRow {
  user_id: number;
  tmdb_id: number;
  media_type: MediaType;
  season: number;
  episode: number;
  position: number;
  duration: number;
  updated_at: number;
  title: string | null;
  poster: string | null;
}

export async function runResumeReminderScan(): Promise<{ scanned: number; sent: number }> {
  const now = Math.floor(Date.now() / 1000);
  const idleFloor = now - IDLE_MAX_SECONDS;
  const idleCeil = now - IDLE_MIN_SECONDS;

  // DISTINCT ON picks the most recently updated progress row per show. We
  // join watchlist (status='in_progress') so reminders only target shows the
  // user has explicitly kept on their list — not titles they abandoned by
  // moving to 'done' or removing.
  const result = await sql<CandidateRow>`
    SELECT DISTINCT ON (p.user_id, p.tmdb_id, p.media_type)
      p.user_id,
      p.tmdb_id,
      p.media_type,
      p.season,
      p.episode,
      p.position,
      p.duration,
      p.updated_at,
      w.title,
      w.poster
    FROM progress p
    INNER JOIN watchlist w
      ON w.user_id = p.user_id
     AND w.tmdb_id = p.tmdb_id
     AND w.media_type = p.media_type
    INNER JOIN users u ON u.id = p.user_id
    WHERE p.synthetic = 0
      AND w.status = 'in_progress'
      AND u.notif_resume_reminder = 1
      AND p.duration > 0
      AND p.updated_at BETWEEN ${idleFloor} AND ${idleCeil}
    ORDER BY p.user_id, p.tmdb_id, p.media_type, p.updated_at DESC
  `.execute(kdb);

  let sent = 0;
  for (const row of result.rows) {
    const fraction = row.position / row.duration;
    if (fraction < PROGRESS_MIN_FRACTION || fraction > PROGRESS_MAX_FRACTION) continue;

    const suppressed = await hasRecentNotificationOfType(
      row.user_id, 'resume_reminder', row.tmdb_id, row.media_type, SUPPRESSION_WINDOW_SECONDS
    );
    if (suppressed) continue;

    const created = await createNotificationsForUsers({
      userIds: [row.user_id],
      type: 'resume_reminder',
      tmdbId: row.tmdb_id,
      mediaType: row.media_type,
      title: row.title,
      poster: row.poster,
      payload: row.media_type === 'tv'
        ? { season: row.season, episode: row.episode }
        : {}
    });
    if (created.length > 0) sent += 1;
  }

  return { scanned: result.rows.length, sent };
}
