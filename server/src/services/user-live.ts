import type { IncomingMessage, Server as HttpServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { authenticateToken, readCookie } from '../middleware/auth';
import { createRedisClient, getRedisPublisher, hasRedisConfig } from './redis';
import type {
  MediaType,
  NotificationCreatedEvent,
  NotificationItem,
  WatchlistUpdatedEvent
} from '../../../shared/types';

const USER_WATCHLIST_WS_PATH = '/user/watchlist/ws';
const USER_NOTIFICATIONS_WS_PATH = '/user/notifications/ws';
const USER_WATCHLIST_CHANNEL = 'streamo:user-watchlist-updates';
const USER_NOTIFICATIONS_CHANNEL = 'streamo:user-notifications';
const HEARTBEAT_INTERVAL_MS = 30000;

interface WatchlistBroadcastEnvelope {
  userIds: number[];
  payload: WatchlistUpdatedEvent;
}

interface NotificationsBroadcastEnvelope {
  userId: number;
  payload: NotificationCreatedEvent;
}

const watchlistClients = new Map<number, Set<WebSocket>>();
const notificationsClients = new Map<number, Set<WebSocket>>();
const heartbeatState = new WeakMap<WebSocket, boolean>();
let heartbeatInterval: NodeJS.Timeout | null = null;
let watchlistSubscriberStarted = false;
let notificationsSubscriberStarted = false;

export function attachUserLiveSessions(server: HttpServer): void {
  const watchlistWss = new WebSocketServer({ noServer: true });
  const notificationsWss = new WebSocketServer({ noServer: true });

  watchlistWss.on('connection', (ws, req) => {
    void (async () => {
      const userId = await getUserId(req);
      if (!userId) {
        ws.close();
        return;
      }

      addToClients(watchlistClients, userId, ws);
      trackClient(ws);

      ws.on('close', () => {
        removeFromClients(watchlistClients, userId, ws);
        clearHeartbeatIntervalIfIdle();
      });
    })();
  });

  notificationsWss.on('connection', (ws, req) => {
    void (async () => {
      const userId = await getUserId(req);
      if (!userId) {
        ws.close();
        return;
      }

      addToClients(notificationsClients, userId, ws);
      trackClient(ws);

      ws.on('close', () => {
        removeFromClients(notificationsClients, userId, ws);
        clearHeartbeatIntervalIfIdle();
      });
    })();
  });

  server.on('upgrade', (req, socket, head) => {
    void (async () => {
      const pathname = getPathname(req);

      let wss: WebSocketServer | null = null;
      if (pathname === USER_WATCHLIST_WS_PATH) wss = watchlistWss;
      else if (pathname === USER_NOTIFICATIONS_WS_PATH) wss = notificationsWss;
      if (!wss) return;

      const token = readCookie(req.headers.cookie, 'token');
      const auth = await authenticateToken(token);
      if (!auth.user) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    })();
  });
}

function addToClients(map: Map<number, Set<WebSocket>>, userId: number, ws: WebSocket): void {
  const clients = map.get(userId) ?? new Set<WebSocket>();
  clients.add(ws);
  map.set(userId, clients);
}

function removeFromClients(map: Map<number, Set<WebSocket>>, userId: number, ws: WebSocket): void {
  const current = map.get(userId);
  if (!current) return;
  current.delete(ws);
  if (current.size === 0) map.delete(userId);
}

export function startUserWatchlistEventsSubscription(): void {
  if (!hasRedisConfig() || watchlistSubscriberStarted) return;
  watchlistSubscriberStarted = true;

  const subscriber = createRedisClient();
  subscriber.on('error', (error) => {
    console.error('[user-live-subscriber:watchlist]', error);
  });
  subscriber.on('message', (channel, message) => {
    try {
      if (channel === USER_WATCHLIST_CHANNEL) {
        const parsed = JSON.parse(message) as WatchlistBroadcastEnvelope;
        broadcastUserWatchlistChanged(parsed.userIds, parsed.payload);
      }
    } catch (error) {
      console.error('[user-live-subscriber:watchlist] invalid payload', error);
    }
  });

  void subscriber.subscribe(USER_WATCHLIST_CHANNEL).catch((error) => {
    console.error('[user-live-subscriber:watchlist] subscribe failed', error);
    subscriber.disconnect();
    watchlistSubscriberStarted = false;
  });
}

export function startUserNotificationsSubscription(): void {
  if (!hasRedisConfig() || notificationsSubscriberStarted) return;
  notificationsSubscriberStarted = true;

  const subscriber = createRedisClient();
  subscriber.on('error', (error) => {
    console.error('[user-live-subscriber:notifications]', error);
  });
  subscriber.on('message', (channel, message) => {
    try {
      if (channel === USER_NOTIFICATIONS_CHANNEL) {
        const parsed = JSON.parse(message) as NotificationsBroadcastEnvelope;
        deliverNotification(parsed.userId, parsed.payload);
      }
    } catch (error) {
      console.error('[user-live-subscriber:notifications] invalid payload', error);
    }
  });

  void subscriber.subscribe(USER_NOTIFICATIONS_CHANNEL).catch((error) => {
    console.error('[user-live-subscriber:notifications] subscribe failed', error);
    subscriber.disconnect();
    notificationsSubscriberStarted = false;
  });
}

export function publishUserWatchlistChanged(
  userIds: number | number[],
  payload: { reason: WatchlistUpdatedEvent['reason']; tmdb_id?: number; media_type?: MediaType }
): void {
  const envelope: WatchlistBroadcastEnvelope = {
    userIds: Array.isArray(userIds) ? userIds : [userIds],
    payload: {
      type: 'watchlist-updated',
      ...payload
    }
  };

  if (!hasRedisConfig()) {
    broadcastUserWatchlistChanged(envelope.userIds, envelope.payload);
    return;
  }

  void getRedisPublisher().publish(USER_WATCHLIST_CHANNEL, JSON.stringify(envelope)).catch((error) => {
    console.error('[user-live-publisher:watchlist]', error);
  });
}

export function publishUserNotificationCreated(userId: number, notification: NotificationItem): void {
  const envelope: NotificationsBroadcastEnvelope = {
    userId,
    payload: { type: 'notification-created', notification }
  };

  if (!hasRedisConfig()) {
    deliverNotification(userId, envelope.payload);
    return;
  }

  void getRedisPublisher().publish(USER_NOTIFICATIONS_CHANNEL, JSON.stringify(envelope)).catch((error) => {
    console.error('[user-live-publisher:notifications]', error);
  });
}

function broadcastUserWatchlistChanged(userIds: number[], payload: WatchlistUpdatedEvent): void {
  const message = JSON.stringify(payload);
  for (const userId of userIds) {
    const clients = watchlistClients.get(userId);
    if (!clients?.size) continue;
    for (const client of clients) {
      if (client.readyState !== WebSocket.OPEN) continue;
      client.send(message);
    }
  }
}

function deliverNotification(userId: number, payload: NotificationCreatedEvent): void {
  const clients = notificationsClients.get(userId);
  if (!clients?.size) return;

  const message = JSON.stringify(payload);
  for (const client of clients) {
    if (client.readyState !== WebSocket.OPEN) continue;
    client.send(message);
  }
}

function trackClient(ws: WebSocket): void {
  heartbeatState.set(ws, true);
  ensureHeartbeatInterval();

  ws.on('pong', () => {
    heartbeatState.set(ws, true);
  });

  ws.on('close', () => {
    heartbeatState.delete(ws);
  });
}

function ensureHeartbeatInterval(): void {
  if (heartbeatInterval) return;
  heartbeatInterval = setInterval(() => {
    for (const clients of watchlistClients.values()) {
      heartbeatClients(clients);
    }
    for (const clients of notificationsClients.values()) {
      heartbeatClients(clients);
    }
    clearHeartbeatIntervalIfIdle();
  }, HEARTBEAT_INTERVAL_MS);
}

function clearHeartbeatIntervalIfIdle(): void {
  if (!heartbeatInterval) return;
  if (watchlistClients.size > 0 || notificationsClients.size > 0) return;
  clearInterval(heartbeatInterval);
  heartbeatInterval = null;
}

function heartbeatClients(clients: Set<WebSocket>): void {
  for (const client of clients) {
    if (client.readyState !== WebSocket.OPEN) continue;

    const alive = heartbeatState.get(client) ?? true;
    if (!alive) {
      client.terminate();
      continue;
    }

    heartbeatState.set(client, false);
    client.ping();
  }
}

async function getUserId(req: IncomingMessage): Promise<number | null> {
  const token = readCookie(req.headers.cookie, 'token');
  const auth = await authenticateToken(token);
  return auth.user?.id ?? null;
}

function getPathname(req: IncomingMessage): string {
  try {
    return new URL(req.url ?? '/', 'http://localhost').pathname;
  } catch {
    return '/';
  }
}
