import type { IncomingMessage, Server as HttpServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { authenticateToken, isSuperAdminUser, readCookie } from '../middleware/auth';
import { listLiveAdminSessions, LIVE_SESSION_WINDOW_SECONDS } from './admin-sessions';
import { getPlaybackLogCapacity, getPlaybackLogPath, listPlaybackLogs, subscribePlaybackLogs } from './playback-logs';
import { getTransportLogCapacity, getTransportLogPath, listTransportLogs, subscribeTransportLogs } from './transport-logs';
import type { AdminSession, PlaybackLogEntry, TransportLogEntry } from '../../../shared/types';

const ADMIN_SESSIONS_WS_PATH = '/admin/sessions/ws';
const ADMIN_PLAYBACK_LOGS_WS_PATH = '/admin/playback-logs/ws';
const ADMIN_TRANSPORT_LOGS_WS_PATH = '/admin/transport-logs/ws';
const EXPIRY_FUZZ_MS = 150;
const HEARTBEAT_INTERVAL_MS = 30000;

interface SessionsPayload {
  type: 'sessions';
  sessions: AdminSession[];
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

let sessionClients = new Set<WebSocket>();
let playbackLogClients = new Set<WebSocket>();
let transportLogClients = new Set<WebSocket>();
const heartbeatState = new WeakMap<WebSocket, boolean>();
let expiryTimeout: NodeJS.Timeout | null = null;
let heartbeatInterval: NodeJS.Timeout | null = null;
let unsubscribePlaybackLogs: (() => void) | null = null;
let unsubscribeTransportLogs: (() => void) | null = null;

export function attachAdminLiveSessions(server: HttpServer): void {
  const sessionsWss = new WebSocketServer({ noServer: true });
  const playbackLogsWss = new WebSocketServer({ noServer: true });
  const transportLogsWss = new WebSocketServer({ noServer: true });

  sessionsWss.on('connection', (ws) => {
    sessionClients.add(ws);
    trackClient(ws);
    broadcastSessions();

    ws.on('close', () => {
      sessionClients.delete(ws);
      if (sessionClients.size === 0) {
        clearExpiryTimeout();
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
    const pathname = getPathname(req);
    if (
      pathname !== ADMIN_SESSIONS_WS_PATH &&
      pathname !== ADMIN_PLAYBACK_LOGS_WS_PATH &&
      pathname !== ADMIN_TRANSPORT_LOGS_WS_PATH
    ) return;

    const token = readCookie(req.headers.cookie, 'token');
    const auth = authenticateToken(token);
    if (!auth.user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    if (!isSuperAdminUser(auth.user)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    const target = pathname === ADMIN_SESSIONS_WS_PATH
      ? sessionsWss
      : pathname === ADMIN_PLAYBACK_LOGS_WS_PATH
        ? playbackLogsWss
        : transportLogsWss;
    target.handleUpgrade(req, socket, head, (ws) => {
      target.emit('connection', ws, req);
    });
  });
}

export function notifyAdminSessionsChanged(): void {
  if (sessionClients.size === 0) return;
  broadcastSessions();
}

function broadcastSessions(): void {
  if (sessionClients.size === 0) {
    clearExpiryTimeout();
    return;
  }

  const sessions = listLiveAdminSessions();
  const payload = JSON.stringify({
    type: 'sessions',
    sessions
  } satisfies SessionsPayload);

  for (const client of sessionClients) {
    if (client.readyState !== WebSocket.OPEN) continue;
    client.send(payload);
  }

  scheduleNextExpiry(sessions);
}

function scheduleNextExpiry(sessions: AdminSession[]): void {
  clearExpiryTimeout();
  if (sessionClients.size === 0 || sessions.length === 0) return;

  let earliestExpiryMs = Number.POSITIVE_INFINITY;
  for (const session of sessions) {
    const expiryMs = (session.updated_at + LIVE_SESSION_WINDOW_SECONDS) * 1000;
    if (expiryMs < earliestExpiryMs) earliestExpiryMs = expiryMs;
  }

  if (!Number.isFinite(earliestExpiryMs)) return;

  const delayMs = Math.max(0, earliestExpiryMs - Date.now() + EXPIRY_FUZZ_MS);
  expiryTimeout = setTimeout(() => {
    expiryTimeout = null;
    broadcastSessions();
  }, delayMs);
}

function clearExpiryTimeout(): void {
  if (!expiryTimeout) return;
  clearTimeout(expiryTimeout);
  expiryTimeout = null;
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
    heartbeatClients(sessionClients);
    heartbeatClients(playbackLogClients);
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
  return sessionClients.size > 0 || playbackLogClients.size > 0 || transportLogClients.size > 0;
}

function getPathname(req: IncomingMessage): string {
  try {
    return new URL(req.url ?? '/', 'http://localhost').pathname;
  } catch {
    return '/';
  }
}
