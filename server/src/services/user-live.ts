import type { IncomingMessage, Server as HttpServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { query } from '../db';
import { authenticateToken, readCookie } from '../middleware/auth';
import { createRedisClient, getRedisPublisher, hasRedisConfig } from './redis';
import type { MediaType, WatchlistUpdatedEvent } from '../../../shared/types';

const USER_WATCHLIST_WS_PATH = '/user/watchlist/ws';
const USER_WATCHLIST_CHANNEL = 'streamo:user-watchlist-updates';
const SHARED_TOKEN_WS_PREFIX = '/shared/';
const SHARED_TOKEN_WS_SUFFIX = '/ws';
const SHARE_LINK_REVOKED_CHANNEL = 'streamo:share-link-revoked';
const HEARTBEAT_INTERVAL_MS = 30000;

/* Per-IP upgrade-attempt cap for the public /shared/<token>/ws path.
 * Matches the spirit of the express-rate-limit on the HTTP endpoint
 * (60/min): legitimate clients open ~1 socket per session and the
 * reconnect backoff tops out at 15s, so even on flaky networks a real
 * user stays well below 30. Sized lower than the HTTP cap because WS
 * upgrades are slightly more expensive (TCP handshake + protocol
 * switch). Counter is per-process — that's fine in single-pod
 * deployments and acceptable in multi-pod ones since each replica
 * caps independently. */
const SHARED_UPGRADE_WINDOW_MS = 60 * 1000;
const SHARED_UPGRADE_MAX = 30;
const SHARED_UPGRADE_CLEANUP_MS = 5 * 60 * 1000;

interface WatchlistBroadcastEnvelope {
  userIds: number[];
  payload: WatchlistUpdatedEvent;
}

interface ShareLinkRevokedEnvelope {
  token: string;
}

const userClients = new Map<number, Set<WebSocket>>();
const sharedTokenClients = new Map<string, Set<WebSocket>>();
const sharedUpgradeAttempts = new Map<string, { count: number; windowStart: number }>();
const heartbeatState = new WeakMap<WebSocket, boolean>();
let heartbeatInterval: NodeJS.Timeout | null = null;
let sharedUpgradeCleanupInterval: NodeJS.Timeout | null = null;
let subscriberStarted = false;

export function attachUserLiveSessions(server: HttpServer): void {
  const watchlistWss = new WebSocketServer({ noServer: true });
  const sharedWss = new WebSocketServer({ noServer: true });

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

  /* Shared-token WS: opened by the public /shared/:token page. We
   * resolve the token to a user_id at upgrade time and add the socket
   * to userClients[user_id] so it receives the same watchlist-updated
   * broadcasts as the owner's own sessions. We also track it by
   * token so suspend/delete can close it actively. */
  sharedWss.on('connection', (ws, req) => {
    const token = (req as IncomingMessage & { _shareToken?: string })._shareToken;
    const userId = (req as IncomingMessage & { _shareUserId?: number })._shareUserId;
    if (!token || !userId) {
      ws.close();
      return;
    }

    addToUserClients(userId, ws);
    addToSharedTokenClients(token, ws);
    trackClient(ws);

    ws.on('close', () => {
      removeFromUserClients(userId, ws);
      removeFromSharedTokenClients(token, ws);
      clearHeartbeatIntervalIfIdle();
    });
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
        return;
      }

      const shareToken = extractShareToken(pathname);
      if (shareToken) {
        const ip = getClientIp(req);
        if (!checkSharedUpgradeRate(ip)) {
          socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
          socket.destroy();
          return;
        }

        const res = await query<{ user_id: number; status: string }>(`
          SELECT user_id, status FROM share_links WHERE token = $1
        `, [shareToken]);
        const row = res.rows[0];

        if (!row || row.status !== 'active') {
          socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
          socket.destroy();
          return;
        }

        const taggedReq = req as IncomingMessage & { _shareToken?: string; _shareUserId?: number };
        taggedReq._shareToken = shareToken;
        taggedReq._shareUserId = row.user_id;

        sharedWss.handleUpgrade(req, socket, head, (ws) => {
          sharedWss.emit('connection', ws, taggedReq);
        });
      }
    })();
  });
}

function extractShareToken(pathname: string): string | null {
  if (!pathname.startsWith(SHARED_TOKEN_WS_PREFIX)) return null;
  if (!pathname.endsWith(SHARED_TOKEN_WS_SUFFIX)) return null;
  const token = pathname.slice(SHARED_TOKEN_WS_PREFIX.length, -SHARED_TOKEN_WS_SUFFIX.length);
  if (!token || token.includes('/')) return null;
  return token;
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

function addToSharedTokenClients(token: string, ws: WebSocket): void {
  const clients = sharedTokenClients.get(token) ?? new Set<WebSocket>();
  clients.add(ws);
  sharedTokenClients.set(token, clients);
}

function removeFromSharedTokenClients(token: string, ws: WebSocket): void {
  const current = sharedTokenClients.get(token);
  if (!current) return;
  current.delete(ws);
  if (current.size === 0) sharedTokenClients.delete(token);
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
      } else if (channel === SHARE_LINK_REVOKED_CHANNEL) {
        const parsed = JSON.parse(message) as ShareLinkRevokedEnvelope;
        closeSharedTokenClients(parsed.token);
      }
    } catch (error) {
      console.error('[user-live-subscriber] invalid payload', error);
    }
  });

  void subscriber.subscribe(USER_WATCHLIST_CHANNEL, SHARE_LINK_REVOKED_CHANNEL).catch((error) => {
    console.error('[user-live-subscriber] subscribe failed', error);
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

/* Called by share-links routes when a token is suspended or deleted.
 * Closes any currently-open shared sockets so the public viewers
 * notice immediately — their next /shared/:token fetch on close will
 * see the 404 and render the "link non disponibile" state. */
export function publishShareLinkRevoked(token: string): void {
  const envelope: ShareLinkRevokedEnvelope = { token };

  if (!hasRedisConfig()) {
    closeSharedTokenClients(token);
    return;
  }

  void getRedisPublisher().publish(SHARE_LINK_REVOKED_CHANNEL, JSON.stringify(envelope)).catch((error) => {
    console.error('[user-live-publisher]', error);
  });
}

function closeSharedTokenClients(token: string): void {
  const clients = sharedTokenClients.get(token);
  if (!clients?.size) return;
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) {
      client.close();
    }
  }
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

/* Returns the client IP, preferring the first hop of X-Forwarded-For
 * (nginx adds the original client there) and falling back to the
 * socket remote address. Identical behavior to what express-rate-limit
 * does internally on the auth-protected routes. */
function getClientIp(req: IncomingMessage): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

function checkSharedUpgradeRate(ip: string): boolean {
  const now = Date.now();
  const entry = sharedUpgradeAttempts.get(ip);
  if (!entry || now - entry.windowStart >= SHARED_UPGRADE_WINDOW_MS) {
    sharedUpgradeAttempts.set(ip, { count: 1, windowStart: now });
    ensureSharedUpgradeCleanup();
    return true;
  }
  if (entry.count >= SHARED_UPGRADE_MAX) return false;
  entry.count += 1;
  return true;
}

/* Periodic sweep so a steady trickle of distinct IPs never bloats the
 * map. Started lazily on first attempt so idle deployments don't pay
 * for an unused timer. */
function ensureSharedUpgradeCleanup(): void {
  if (sharedUpgradeCleanupInterval) return;
  sharedUpgradeCleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of sharedUpgradeAttempts) {
      if (now - entry.windowStart >= SHARED_UPGRADE_WINDOW_MS) {
        sharedUpgradeAttempts.delete(ip);
      }
    }
    if (sharedUpgradeAttempts.size === 0 && sharedUpgradeCleanupInterval) {
      clearInterval(sharedUpgradeCleanupInterval);
      sharedUpgradeCleanupInterval = null;
    }
  }, SHARED_UPGRADE_CLEANUP_MS);
  sharedUpgradeCleanupInterval.unref();
}
