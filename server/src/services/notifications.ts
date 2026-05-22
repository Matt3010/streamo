import { kdb } from '../db';
import { publishUserNotificationCreated } from './user-live';
import type {
  MediaType,
  NotificationItem,
  NotificationListResponse,
  NotificationPayload,
  NotificationType
} from '../../../shared/types';

// Suppress duplicate notifications produced within this window. The worker
// is scheduled (BullMQ scan) so a flaky TMDB response shouldn't double-notify
// the same user about the same release.
const DEDUPE_WINDOW_SECONDS = 7 * 24 * 60 * 60;

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

  const payloadJson = stringifyPayload(input.payload ?? {});
  const dedupeCutoff = Math.floor(Date.now() / 1000) - DEDUPE_WINDOW_SECONDS;
  const created: NotificationItem[] = [];

  for (const userId of input.userIds) {
    const exists = await kdb
      .selectFrom('notifications')
      .select('id')
      .where('user_id', '=', userId)
      .where('type', '=', input.type)
      .where('tmdb_id', '=', input.tmdbId)
      .where('media_type', '=', input.mediaType)
      .where('payload_json', '=', payloadJson)
      .where('created_at', '>=', dedupeCutoff)
      .limit(1)
      .executeTakeFirst();
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

export async function deleteNotification(userId: number, id: number): Promise<boolean> {
  const result = await kdb
    .deleteFrom('notifications')
    .where('user_id', '=', userId)
    .where('id', '=', id)
    .executeTakeFirst();
  return Number(result?.numDeletedRows ?? 0) > 0;
}

// Stable JSON for the dedupe equality check — JS object key order is insertion
// order, so without sorting the worker and a future caller could produce
// `{"season":2,"episode":5}` and `{"episode":5,"season":2}` and bypass dedupe.
function stringifyPayload(payload: NotificationPayload): string {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(payload).sort()) {
    const value = (payload as Record<string, unknown>)[key];
    if (value !== undefined) sorted[key] = value;
  }
  return JSON.stringify(sorted);
}

function parsePayload(raw: string): NotificationPayload {
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as NotificationPayload) : {};
  } catch {
    return {};
  }
}
