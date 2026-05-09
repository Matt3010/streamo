import type { IncomingMessage, Server as HttpServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { authenticateToken, isSuperAdminUser, readCookie } from '../middleware/auth';
import { listLiveAdminSessions, LIVE_SESSION_WINDOW_SECONDS } from './admin-sessions';
import type { AdminSession } from '../../../shared/types';

const ADMIN_SESSIONS_WS_PATH = '/admin/sessions/ws';
const EXPIRY_FUZZ_MS = 150;

interface SessionsPayload {
  type: 'sessions';
  sessions: AdminSession[];
}

let clients = new Set<WebSocket>();
let expiryTimeout: NodeJS.Timeout | null = null;

export function attachAdminLiveSessions(server: HttpServer): void {
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws) => {
    clients.add(ws);
    broadcastSessions();

    ws.on('close', () => {
      clients.delete(ws);
      if (clients.size === 0) {
        clearExpiryTimeout();
      }
    });
  });

  server.on('upgrade', (req, socket, head) => {
    const pathname = getPathname(req);
    if (pathname !== ADMIN_SESSIONS_WS_PATH) return;

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

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });
}

export function notifyAdminSessionsChanged(): void {
  if (clients.size === 0) return;
  broadcastSessions();
}

function broadcastSessions(): void {
  if (clients.size === 0) {
    clearExpiryTimeout();
    return;
  }

  const sessions = listLiveAdminSessions();
  const payload = JSON.stringify({
    type: 'sessions',
    sessions
  } satisfies SessionsPayload);

  for (const client of clients) {
    if (client.readyState !== WebSocket.OPEN) continue;
    client.send(payload);
  }

  scheduleNextExpiry(sessions);
}

function scheduleNextExpiry(sessions: AdminSession[]): void {
  clearExpiryTimeout();
  if (clients.size === 0 || sessions.length === 0) return;

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

function getPathname(req: IncomingMessage): string {
  try {
    return new URL(req.url ?? '/', 'http://localhost').pathname;
  } catch {
    return '/';
  }
}
