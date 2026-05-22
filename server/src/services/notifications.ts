import { kdb } from '../db';
import { publishUserNotificationCreated } from './user-live';
import { enqueuePushDelivery } from './notifications-jobs';
import type {
  MediaType,
  NotificationItem,
  NotificationListResponse,
  NotificationPayload,
  NotificationType
} from '../../../shared/types';

// Suppress duplicate notifications produced within this window for the same
// (user, type, tmdb_id, media_type). TMDB refreshes are incremental — an
// initial "+1 episode" reading often becomes "+2" minutes later — and we
// don't want each correction to spawn its own ping. Resume reminders use
// their own 30d suppression via hasRecentNotificationOfType.
const CREATE_DEDUPE_WINDOW_SECONDS = 7 * 24 * 60 * 60;

interface CreateInput {
  userIds: number[];
  type: NotificationType;
  tmdbId: number;
  mediaType: MediaType;
  title: string | null;
  poster: string | null;
  payload: NotificationPayload;
}

export async function createNotificationsForUsers(input: CreateInput): Promise<NotificationItem[]> {
  if (input.userIds.length === 0) return [];

  // payload_json is stored for display only — the exact contents (esp.
  // aired_delta) shift on every refresh, so we deliberately do NOT key the
  // dedupe off it. The dedupe key is (user, type, tmdb_id, media_type).
  const payloadJson = JSON.stringify(input.payload ?? {});
  const created: NotificationItem[] = [];

  for (const userId of input.userIds) {
    const exists = await hasRecentNotificationOfType(
      userId, input.type, input.tmdbId, input.mediaType, CREATE_DEDUPE_WINDOW_SECONDS
    );
    if (exists) continue;

    const row = await kdb
      .insertInto('notifications')
      .values({
        user_id: userId,
        type: input.type,
        tmdb_id: input.tmdbId,
        media_type: input.mediaType,
        title: input.title,
        poster: input.poster,
        payload_json: payloadJson
      })
      .returning(['id', 'created_at'])
      .executeTakeFirstOrThrow();

    const item: NotificationItem = {
      id: row.id,
      type: input.type,
      tmdb_id: input.tmdbId,
      media_type: input.mediaType,
      title: input.title,
      poster: input.poster,
      payload: input.payload,
      created_at: row.created_at,
      read_at: null
    };
    created.push(item);
    publishUserNotificationCreated(userId, item);
    // Enqueue on the notifications-delivery BullMQ queue. The worker
    // calls sendPushToUser with retry+backoff. This run never awaits
    // the actual FCM round-trip — its caller (a watchlist or
    // resume-reminder job) shouldn't be blocked by Google's latency.
    void enqueuePushDelivery(userId, item).catch((error) => {
      console.error(`[notifications] enqueue push failed user=${userId} id=${item.id}`, error);
    });
  }

  return created;
}

export async function listNotificationsForUser(
  userId: number,
  limit: number
): Promise<NotificationListResponse> {
  const rows = await kdb
    .selectFrom('notifications')
    .select(['id', 'type', 'tmdb_id', 'media_type', 'title', 'poster', 'payload_json', 'created_at', 'read_at'])
    .where('user_id', '=', userId)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(limit)
    .execute();

  const items = rows.map((row) => ({
    id: row.id,
    type: row.type as NotificationType,
    tmdb_id: row.tmdb_id,
    media_type: row.media_type as MediaType,
    title: row.title,
    poster: row.poster,
    payload: parsePayload(row.payload_json),
    created_at: row.created_at,
    read_at: row.read_at
  }));

  const unread = await kdb
    .selectFrom('notifications')
    .select((eb) => eb.fn.countAll<string>().as('cnt'))
    .where('user_id', '=', userId)
    .where('read_at', 'is', null)
    .executeTakeFirstOrThrow();

  return { items, unread_count: Number(unread.cnt) };
}

export async function markNotificationRead(userId: number, id: number): Promise<boolean> {
  const result = await kdb
    .updateTable('notifications')
    .set({ read_at: Math.floor(Date.now() / 1000) })
    .where('user_id', '=', userId)
    .where('id', '=', id)
    .where('read_at', 'is', null)
    .executeTakeFirst();
  return Number(result?.numUpdatedRows ?? 0) > 0;
}

export async function markAllNotificationsRead(userId: number): Promise<number> {
  const result = await kdb
    .updateTable('notifications')
    .set({ read_at: Math.floor(Date.now() / 1000) })
    .where('user_id', '=', userId)
    .where('read_at', 'is', null)
    .executeTakeFirst();
  return Number(result?.numUpdatedRows ?? 0);
}

// Per-call suppression check. Used both internally (CREATE_DEDUPE_WINDOW_SECONDS)
// and by callers that need a non-default window (e.g. resume reminders, which
// should be suppressed for 30d rather than the standard 7d).
export async function hasRecentNotificationOfType(
  userId: number,
  type: NotificationType,
  tmdbId: number,
  mediaType: MediaType,
  withinSeconds: number
): Promise<boolean> {
  const cutoff = Math.floor(Date.now() / 1000) - withinSeconds;
  const row = await kdb
    .selectFrom('notifications')
    .select('id')
    .where('user_id', '=', userId)
    .where('type', '=', type)
    .where('tmdb_id', '=', tmdbId)
    .where('media_type', '=', mediaType)
    .where('created_at', '>=', cutoff)
    .limit(1)
    .executeTakeFirst();
  return !!row;
}

export async function deleteNotification(userId: number, id: number): Promise<boolean> {
  const result = await kdb
    .deleteFrom('notifications')
    .where('user_id', '=', userId)
    .where('id', '=', id)
    .executeTakeFirst();
  return Number(result?.numDeletedRows ?? 0) > 0;
}

function parsePayload(raw: string): NotificationPayload {
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as NotificationPayload) : {};
  } catch {
    return {};
  }
}
