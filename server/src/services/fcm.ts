import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getMessaging, type Messaging, type MulticastMessage } from 'firebase-admin/messaging';
import { kdb } from '../db';
import { FCM_PROJECT_ID, FCM_SERVICE_ACCOUNT_JSON_B64, isFcmConfigured } from '../config';
import type { NotificationItem } from '../../../shared/types';
import { formatNotification, notificationTargetPath } from '../../../shared/notification-format';

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
  const { title, body } = formatNotification(notification);
  const link = notificationTargetPath(notification);
  const message: MulticastMessage = {
    tokens,
    notification: { title, body },
    data: {
      notification_id: String(notification.id),
      type: notification.type,
      tmdb_id: String(notification.tmdb_id),
      media_type: notification.media_type,
      click_url: link
    },
    webpush: {
      fcmOptions: { link },
      notification: {
        icon: notification.poster ?? undefined,
        // Tag granularity: include type + season/episode so back-to-back
        // releases (S5E1 then S5E2) and a resume_reminder for the same show
        // don't coalesce into a single banner. Same payload arriving twice
        // (worker re-fire, multi-device with one offline) still dedupes
        // because the tag is fully deterministic from the payload.
        tag: buildPushTag(notification)
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

function buildPushTag(notification: NotificationItem): string {
  const base = `streamo-${notification.type}-${notification.media_type}-${notification.tmdb_id}`;
  const { season, episode } = notification.payload ?? {};
  if (season && episode) return `${base}-s${season}e${episode}`;
  if (season) return `${base}-s${season}`;
  return base;
}
