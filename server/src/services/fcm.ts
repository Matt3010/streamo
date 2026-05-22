import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getMessaging, type Messaging, type MulticastMessage } from 'firebase-admin/messaging';
import { kdb } from '../db';
import { FCM_PROJECT_ID, FCM_SERVICE_ACCOUNT_JSON_B64, isFcmConfigured } from '../config';
import type { NotificationItem, NotificationType } from '../../../shared/types';

const FIREBASE_APP_NAME = 'streamo-fcm';

// Codes that mean "this token is dead — never deliver to it again".
// Transient codes (quota, network) are NOT in this set so we don't
// prune perfectly good tokens on a flaky 503.
const PERMANENT_FAILURE_CODES = new Set<string>([
  'messaging/invalid-argument',
  'messaging/invalid-registration-token',
  'messaging/registration-token-not-registered',
  'messaging/mismatched-credential'
]);

let cachedApp: App | null = null;
let initFailed = false;

function getApp(): App | null {
  if (cachedApp) return cachedApp;
  if (initFailed || !isFcmConfigured()) return null;

  try {
    const decoded = Buffer.from(FCM_SERVICE_ACCOUNT_JSON_B64, 'base64').toString('utf8');
    const credentials = JSON.parse(decoded);
    // Reuse an already-initialized app in dev/hot-reload scenarios so the
    // SDK doesn't throw "already exists". We namespace under FIREBASE_APP_NAME
    // to avoid colliding with anything else that ever calls initializeApp().
    const existing = getApps().find((app) => app.name === FIREBASE_APP_NAME);
    cachedApp = existing ?? initializeApp(
      { credential: cert(credentials), projectId: FCM_PROJECT_ID },
      FIREBASE_APP_NAME
    );
    return cachedApp;
  } catch (error) {
    initFailed = true;
    console.error('[fcm] init failed — push disabled for this process', error);
    return null;
  }
}

function getMessagingClient(): Messaging | null {
  const app = getApp();
  return app ? getMessaging(app) : null;
}

export async function sendPushToUser(userId: number, notification: NotificationItem): Promise<void> {
  const messaging = getMessagingClient();
  if (!messaging) return;

  const rows = await kdb
    .selectFrom('fcm_tokens')
    .select(['token'])
    .where('user_id', '=', userId)
    .execute();
  if (rows.length === 0) return;

  const tokens = rows.map((r) => r.token);
  const message: MulticastMessage = {
    tokens,
    notification: {
      title: buildTitle(notification),
      body: buildBody(notification)
    },
    data: {
      notification_id: String(notification.id),
      type: notification.type,
      tmdb_id: String(notification.tmdb_id),
      media_type: notification.media_type,
      click_url: buildClickUrl(notification)
    },
    webpush: {
      fcmOptions: { link: buildClickUrl(notification) },
      notification: {
        icon: notification.poster ?? undefined,
        tag: `streamo-${notification.media_type}-${notification.tmdb_id}`,
        // Collapse repeated pushes for the same show into one OS notification
        // — useful when the worker re-fires after a reconnect or the user
        // has many devices and one was offline.
        renotify: false
      }
    }
  };

  try {
    const result = await messaging.sendEachForMulticast(message);
    await pruneInvalidTokens(userId, tokens, result.responses);
  } catch (error) {
    console.error(`[fcm] send failed for user=${userId} tokens=${tokens.length}`, error);
  }
}

async function pruneInvalidTokens(
  userId: number,
  tokens: string[],
  responses: Array<{ success: boolean; error?: { code: string } }>
): Promise<void> {
  const dead: string[] = [];
  for (let i = 0; i < responses.length; i += 1) {
    const r = responses[i];
    if (r.success) continue;
    const code = r.error?.code;
    if (code && PERMANENT_FAILURE_CODES.has(code)) {
      dead.push(tokens[i]);
    }
  }
  if (dead.length === 0) return;

  await kdb
    .deleteFrom('fcm_tokens')
    .where('user_id', '=', userId)
    .where('token', 'in', dead)
    .execute();

  console.log(`[fcm] pruned ${dead.length} dead tokens for user=${userId} (prefixes=${dead.map(redactToken).join(',')})`);
}

export function redactToken(token: string): string {
  if (!token) return '';
  return `${token.slice(0, 12)}…`;
}

function buildClickUrl(notification: NotificationItem): string {
  // Always a same-origin path, constructed from a fixed template. The
  // service worker (PR 4) will still validate this is same-origin before
  // calling clients.openWindow(), as defense in depth.
  return `/watch/${notification.media_type}/${notification.tmdb_id}`;
}

function buildTitle(notification: NotificationItem): string {
  return notification.title ?? defaultLabelFor(notification.type);
}

function defaultLabelFor(type: NotificationType): string {
  switch (type) {
    case 'new_episode': return 'Nuovo episodio';
    case 'new_season': return 'Nuova stagione';
    case 'resume_reminder': return 'Riprendi a guardare';
  }
}

function buildBody(notification: NotificationItem): string {
  const { season, episode, aired_delta } = notification.payload ?? {};
  switch (notification.type) {
    case 'new_season':
      return season ? `Nuova stagione disponibile (S${season})` : 'Nuova stagione disponibile';
    case 'new_episode':
      if (aired_delta && aired_delta > 1) return `${aired_delta} nuovi episodi`;
      if (season && episode) return `Nuovo episodio: S${season} E${episode}`;
      return 'Nuovo episodio disponibile';
    case 'resume_reminder':
      if (season && episode) return `Riprendi da S${season} E${episode}`;
      return 'Hai un titolo da finire';
  }
}
