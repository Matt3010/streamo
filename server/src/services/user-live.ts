import type { IncomingMessage, Server as HttpServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { authenticateToken, readCookie } from '../middleware/auth';
import { createRedisClient, getRedisPublisher, hasRedisConfig } from './redis';
import type { MediaType, WatchlistUpdatedEvent } from '../../../shared/types';

const USER_WATCHLIST_WS_PATH = '/user/watchlist/ws';
const USER_WATCHLIST_CHANNEL = 'streamo:user-watchlist-updates';
const HEARTBEAT_INTERVAL_MS = 30000;

interface WatchlistBroadcastEnvelope {
  userIds: number[];
  payload: WatchlistUpdatedEvent;
}

const userClients = new Map<number, Set<WebSocket>>();
const heartbeatState = new WeakMap<WebSocket, boolean>();
let heartbeatInterval: NodeJS.Timeout | null = null;
let subscriberStarted = false;

export function attachUserLiveSessions(server: HttpServer): void {
  const watchlistWss = new WebSocketServer({ noServer: true });

  watchlistWss.on('connection', (ws, req) => {
    void (async () => {
      const userId = await getUserId(req);
      if (!userId) {
        ws.close();
        return;
      }

      addToUserClients(userId, ws);
      trackClient(ws);

      ws.on('close', () => {
        removeFromUserClients(userId, ws);
        clearHeartbeatIntervalIfIdle();
      });
    })();
  });

  server.on('upgrade', (req, socket, head) => {
    void (async () => {
      const pathname = getPathname(req);

      if (pathname === USER_WATCHLIST_WS_PATH) {
        const token = readCookie(req.headers.cookie, 'token');
        const auth = await authenticateToken(token);
        if (!auth.user) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }

        watchlistWss.handleUpgrade(req, socket, head, (ws) => {
          watchlistWss.emit('connection', ws, req);
        });
      }
    })();
  });
}

function addToUserClients(userId: number, ws: WebSocket): void {
  const clients = userClients.get(userId) ?? new Set<WebSocket>();
  clients.add(ws);
  userClients.set(userId, clients);
}

function removeFromUserClients(userId: number, ws: WebSocket): void {
  const current = userClients.get(userId);
  if (!current) return;
  current.delete(ws);
  if (current.size === 0) userClients.delete(userId);
}

export function startUserWatchlistEventsSubscription(): void {
  if (!hasRedisConfig() || subscriberStarted) return;
  subscriberStarted = true;

  const subscriber = createRedisClient();
  subscriber.on('error', (error) => {
    console.error('[user-live-subscriber]', error);
  });
  subscriber.on('message', (channel, message) => {
    try {
      if (channel === USER_WATCHLIST_CHANNEL) {
        const parsed = JSON.parse(message) as WatchlistBroadcastEnvelope;
        broadcastUserWatchlistChanged(parsed.userIds, parsed.payload);
      }
    } catch (error) {
      console.error('[user-live-subscriber] invalid payload', error);
    }
  });

  void subscriber.subscribe(USER_WATCHLIST_CHANNEL).catch((error) => {
    console.error('[user-live-subscriber] subscribe failed', error);
    subscriber.disconnect();
    subscriberStarted = false;
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
    console.error('[user-live-publisher]', error);
  });
}

function broadcastUserWatchlistChanged(userIds: number[], payload: WatchlistUpdatedEvent): void {
  for (const userId of userIds) {
    const clients = userClients.get(userId);
    if (!clients?.size) continue;

    const message = JSON.stringify(payload);
    for (const client of clients) {
      if (client.readyState !== WebSocket.OPEN) continue;
      client.send(message);
    }
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
    for (const clients of userClients.values()) {
      heartbeatClients(clients);
    }
    clearHeartbeatIntervalIfIdle();
  }, HEARTBEAT_INTERVAL_MS);
}

function clearHeartbeatIntervalIfIdle(): void {
  if (!heartbeatInterval || userClients.size > 0) return;
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
