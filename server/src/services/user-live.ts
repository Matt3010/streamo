import type { IncomingMessage, Server as HttpServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { authenticateToken, readCookie } from '../middleware/auth';
import type { MediaType, WatchlistUpdatedEvent } from '../../../shared/types';

const USER_WATCHLIST_WS_PATH = '/user/watchlist/ws';
const HEARTBEAT_INTERVAL_MS = 30000;

const userClients = new Map<number, Set<WebSocket>>();
const heartbeatState = new WeakMap<WebSocket, boolean>();
let heartbeatInterval: NodeJS.Timeout | null = null;

export function attachUserLiveSessions(server: HttpServer): void {
  const watchlistWss = new WebSocketServer({ noServer: true });

  watchlistWss.on('connection', (ws, req) => {
    const userId = getUserId(req);
    if (!userId) {
      ws.close();
      return;
    }

    const clients = userClients.get(userId) ?? new Set<WebSocket>();
    clients.add(ws);
    userClients.set(userId, clients);
    trackClient(ws);

    ws.on('close', () => {
      const current = userClients.get(userId);
      if (!current) return;
      current.delete(ws);
      if (current.size === 0) userClients.delete(userId);
      clearHeartbeatIntervalIfIdle();
    });
  });

  server.on('upgrade', (req, socket, head) => {
    const pathname = getPathname(req);
    if (pathname !== USER_WATCHLIST_WS_PATH) return;

    const token = readCookie(req.headers.cookie, 'token');
    const auth = authenticateToken(token);
    if (!auth.user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    watchlistWss.handleUpgrade(req, socket, head, (ws) => {
      watchlistWss.emit('connection', ws, req);
    });
  });
}

export function notifyUserWatchlistChanged(
  userIds: number | number[],
  payload: { reason: WatchlistUpdatedEvent['reason']; tmdb_id?: number; media_type?: MediaType }
): void {
  const ids = Array.isArray(userIds) ? userIds : [userIds];
  const message = JSON.stringify({
    type: 'watchlist-updated',
    ...payload
  } satisfies WatchlistUpdatedEvent);

  for (const userId of ids) {
    const clients = userClients.get(userId);
    if (!clients?.size) continue;

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

function getUserId(req: IncomingMessage): number | null {
  const token = readCookie(req.headers.cookie, 'token');
  const auth = authenticateToken(token);
  return auth.user?.id ?? null;
}

function getPathname(req: IncomingMessage): string {
  try {
    return new URL(req.url ?? '/', 'http://localhost').pathname;
  } catch {
    return '/';
  }
}
