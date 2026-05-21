import type { IncomingMessage, Server as HttpServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { authenticateToken, isSuperAdminUser, readCookie } from '../middleware/auth';
import { authLogger, getAuthLogCapacity, getAuthLogPath, listAuthLogs, subscribeAuthLogs } from './auth-logs';
import { getPlaybackLogCapacity, getPlaybackLogPath, listPlaybackLogs, subscribePlaybackLogs } from './playback-logs';
import {
  getProviderResolveLogCapacity,
  getProviderResolveLogPath,
  listProviderResolveLogs,
  subscribeProviderResolveLogs
} from './provider-resolve-logs';
import { getTransportLogCapacity, getTransportLogPath, listTransportLogs, subscribeTransportLogs } from './transport-logs';
import type {
  AuthLogEntry,
  PlaybackLogEntry,
  ProviderResolveLogEntry,
  TransportLogEntry
} from '../../../shared/types';

const ADMIN_AUTH_LOGS_WS_PATH = '/admin/auth-logs/ws';
const ADMIN_PLAYBACK_LOGS_WS_PATH = '/admin/playback-logs/ws';
const ADMIN_PROVIDER_RESOLVE_LOGS_WS_PATH = '/admin/provider-resolve-logs/ws';
const ADMIN_TRANSPORT_LOGS_WS_PATH = '/admin/transport-logs/ws';
const HEARTBEAT_INTERVAL_MS = 30000;

interface AuthLogsPayload {
  type: 'auth-logs';
  count: number;
  capacity: number;
  path: string;
  logs: AuthLogEntry[];
}

interface PlaybackLogsPayload {
  type: 'playback-logs';
  count: number;
  capacity: number;
  path: string;
  logs: PlaybackLogEntry[];
}

interface TransportLogsPayload {
  type: 'transport-logs';
  count: number;
  capacity: number;
  path: string;
  logs: TransportLogEntry[];
}

interface ProviderResolveLogsPayload {
  type: 'provider-resolve-logs';
  count: number;
  capacity: number;
  path: string;
  logs: ProviderResolveLogEntry[];
}

const authLogClients = new Set<WebSocket>();
const playbackLogClients = new Set<WebSocket>();
const providerResolveLogClients = new Set<WebSocket>();
const transportLogClients = new Set<WebSocket>();
const heartbeatState = new WeakMap<WebSocket, boolean>();
let heartbeatInterval: NodeJS.Timeout | null = null;
let unsubscribeAuthLogs: (() => void) | null = null;
let unsubscribePlaybackLogs: (() => void) | null = null;
let unsubscribeProviderResolveLogs: (() => void) | null = null;
let unsubscribeTransportLogs: (() => void) | null = null;

export function attachAdminLiveSessions(server: HttpServer): void {
  const authLogsWss = new WebSocketServer({ noServer: true });
  const playbackLogsWss = new WebSocketServer({ noServer: true });
  const providerResolveLogsWss = new WebSocketServer({ noServer: true });
  const transportLogsWss = new WebSocketServer({ noServer: true });

  authLogsWss.on('connection', (ws) => {
    authLogClients.add(ws);
    trackClient(ws);
    ensureAuthLogSubscription();
    broadcastAuthLogs();

    ws.on('close', () => {
      authLogClients.delete(ws);
      if (authLogClients.size === 0) {
        clearAuthLogSubscription();
      }
    });
  });

  playbackLogsWss.on('connection', (ws) => {
    playbackLogClients.add(ws);
    trackClient(ws);
    ensurePlaybackLogSubscription();
    broadcastPlaybackLogs();

    ws.on('close', () => {
      playbackLogClients.delete(ws);
      if (playbackLogClients.size === 0) {
        clearPlaybackLogSubscription();
      }
    });
  });

  providerResolveLogsWss.on('connection', (ws) => {
    providerResolveLogClients.add(ws);
    trackClient(ws);
    ensureProviderResolveLogSubscription();
    broadcastProviderResolveLogs();

    ws.on('close', () => {
      providerResolveLogClients.delete(ws);
      if (providerResolveLogClients.size === 0) {
        clearProviderResolveLogSubscription();
      }
    });
  });

  transportLogsWss.on('connection', (ws) => {
    transportLogClients.add(ws);
    trackClient(ws);
    ensureTransportLogSubscription();
    broadcastTransportLogs();

    ws.on('close', () => {
      transportLogClients.delete(ws);
      if (transportLogClients.size === 0) {
        clearTransportLogSubscription();
      }
    });
  });

  server.on('upgrade', (req, socket, head) => {
    void (async () => {
      const pathname = getPathname(req);
      if (
        pathname !== ADMIN_AUTH_LOGS_WS_PATH &&
        pathname !== ADMIN_PLAYBACK_LOGS_WS_PATH &&
        pathname !== ADMIN_PROVIDER_RESOLVE_LOGS_WS_PATH &&
        pathname !== ADMIN_TRANSPORT_LOGS_WS_PATH
      ) return;

      const token = readCookie(req.headers.cookie, 'token');
      const auth = await authenticateToken(token);
      if (!auth.user) {
        authLogger.warn('admin websocket auth denied', {
          reason: auth.error ?? 'unauthenticated',
          requestUri: pathname,
          ip: req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '-',
          userAgent: req.headers['user-agent'] ?? '-'
        });
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      if (!isSuperAdminUser(auth.user)) {
        authLogger.warn('admin websocket forbidden', {
          reason: 'super_admin_required',
          requestUri: pathname,
          ip: req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '-',
          userAgent: req.headers['user-agent'] ?? '-',
          user: auth.user.email
        });
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }

      const target = pathname === ADMIN_AUTH_LOGS_WS_PATH
        ? authLogsWss
        : pathname === ADMIN_PLAYBACK_LOGS_WS_PATH
          ? playbackLogsWss
          : pathname === ADMIN_PROVIDER_RESOLVE_LOGS_WS_PATH
            ? providerResolveLogsWss
            : transportLogsWss;
      target.handleUpgrade(req, socket, head, (ws) => {
        target.emit('connection', ws, req);
      });
    })();
  });
}

function broadcastAuthLogs(): void {
  if (authLogClients.size === 0) {
    clearAuthLogSubscription();
    return;
  }

  const logs = listAuthLogs();
  const payload = JSON.stringify({
    type: 'auth-logs',
    count: logs.length,
    capacity: getAuthLogCapacity(),
    path: getAuthLogPath(),
    logs
  } satisfies AuthLogsPayload);

  for (const client of authLogClients) {
    if (client.readyState !== WebSocket.OPEN) continue;
    client.send(payload);
  }
}

function ensureAuthLogSubscription(): void {
  if (unsubscribeAuthLogs) return;
  unsubscribeAuthLogs = subscribeAuthLogs(() => {
    if (authLogClients.size === 0) return;
    broadcastAuthLogs();
  });
}

function clearAuthLogSubscription(): void {
  if (authLogClients.size > 0 || !unsubscribeAuthLogs) return;
  unsubscribeAuthLogs();
  unsubscribeAuthLogs = null;
}

function broadcastPlaybackLogs(): void {
  if (playbackLogClients.size === 0) {
    clearPlaybackLogSubscription();
    return;
  }

  const logs = listPlaybackLogs();
  const payload = JSON.stringify({
    type: 'playback-logs',
    count: logs.length,
    capacity: getPlaybackLogCapacity(),
    path: getPlaybackLogPath(),
    logs
  } satisfies PlaybackLogsPayload);

  for (const client of playbackLogClients) {
    if (client.readyState !== WebSocket.OPEN) continue;
    client.send(payload);
  }
}

function ensurePlaybackLogSubscription(): void {
  if (unsubscribePlaybackLogs) return;
  unsubscribePlaybackLogs = subscribePlaybackLogs(() => {
    if (playbackLogClients.size === 0) return;
    broadcastPlaybackLogs();
  });
}

function clearPlaybackLogSubscription(): void {
  if (playbackLogClients.size > 0 || !unsubscribePlaybackLogs) return;
  unsubscribePlaybackLogs();
  unsubscribePlaybackLogs = null;
}

function broadcastTransportLogs(): void {
  if (transportLogClients.size === 0) {
    clearTransportLogSubscription();
    return;
  }

  const logs = listTransportLogs();
  const payload = JSON.stringify({
    type: 'transport-logs',
    count: logs.length,
    capacity: getTransportLogCapacity(),
    path: getTransportLogPath(),
    logs
  } satisfies TransportLogsPayload);

  for (const client of transportLogClients) {
    if (client.readyState !== WebSocket.OPEN) continue;
    client.send(payload);
  }
}

function broadcastProviderResolveLogs(): void {
  if (providerResolveLogClients.size === 0) {
    clearProviderResolveLogSubscription();
    return;
  }

  const logs = listProviderResolveLogs();
  const payload = JSON.stringify({
    type: 'provider-resolve-logs',
    count: logs.length,
    capacity: getProviderResolveLogCapacity(),
    path: getProviderResolveLogPath(),
    logs
  } satisfies ProviderResolveLogsPayload);

  for (const client of providerResolveLogClients) {
    if (client.readyState !== WebSocket.OPEN) continue;
    client.send(payload);
  }
}

function ensureProviderResolveLogSubscription(): void {
  if (unsubscribeProviderResolveLogs) return;
  unsubscribeProviderResolveLogs = subscribeProviderResolveLogs(() => {
    if (providerResolveLogClients.size === 0) return;
    broadcastProviderResolveLogs();
  });
}

function clearProviderResolveLogSubscription(): void {
  if (providerResolveLogClients.size > 0 || !unsubscribeProviderResolveLogs) return;
  unsubscribeProviderResolveLogs();
  unsubscribeProviderResolveLogs = null;
}

function ensureTransportLogSubscription(): void {
  if (unsubscribeTransportLogs) return;
  unsubscribeTransportLogs = subscribeTransportLogs(() => {
    if (transportLogClients.size === 0) return;
    broadcastTransportLogs();
  });
}

function clearTransportLogSubscription(): void {
  if (transportLogClients.size > 0 || !unsubscribeTransportLogs) return;
  unsubscribeTransportLogs();
  unsubscribeTransportLogs = null;
}

function trackClient(ws: WebSocket): void {
  heartbeatState.set(ws, true);
  ensureHeartbeatInterval();

  ws.on('pong', () => {
    heartbeatState.set(ws, true);
  });

  ws.on('close', () => {
    heartbeatState.delete(ws);
    clearHeartbeatIntervalIfIdle();
  });
}

function ensureHeartbeatInterval(): void {
  if (heartbeatInterval) {
    return;
  }

  heartbeatInterval = setInterval(() => {
    heartbeatClients(authLogClients);
    heartbeatClients(playbackLogClients);
    heartbeatClients(providerResolveLogClients);
    heartbeatClients(transportLogClients);
    clearHeartbeatIntervalIfIdle();
  }, HEARTBEAT_INTERVAL_MS);
}

function clearHeartbeatIntervalIfIdle(): void {
  if (heartbeatInterval && !hasAnyClients()) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

function heartbeatClients(clients: Set<WebSocket>): void {
  for (const client of clients) {
    if (client.readyState !== WebSocket.OPEN) {
      continue;
    }

    const alive = heartbeatState.get(client) ?? true;
    if (!alive) {
      client.terminate();
      continue;
    }

    heartbeatState.set(client, false);
    client.ping();
  }
}

function hasAnyClients(): boolean {
  return authLogClients.size > 0 ||
    playbackLogClients.size > 0 ||
    providerResolveLogClients.size > 0 ||
    transportLogClients.size > 0;
}

function getPathname(req: IncomingMessage): string {
  try {
    return new URL(req.url ?? '/', 'http://localhost').pathname;
  } catch {
    return '/';
  }
}
