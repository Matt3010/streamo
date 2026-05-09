import type { IncomingMessage, Server as HttpServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { authenticateToken, isSuperAdminUser, readCookie } from '../middleware/auth';
import { listLiveAdminSessions } from './admin-sessions';
import type { AdminSession } from '../../../shared/types';

const ADMIN_SESSIONS_WS_PATH = '/admin/sessions/ws';
const PUSH_INTERVAL_MS = 5000;

interface SessionsPayload {
  type: 'sessions';
  sessions: AdminSession[];
}

export function attachAdminLiveSessions(server: HttpServer): void {
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set<WebSocket>();
  let interval: NodeJS.Timeout | null = null;

  const stopIntervalIfIdle = () => {
    if (clients.size === 0 && interval) {
      clearInterval(interval);
      interval = null;
    }
  };

  const broadcastSessions = () => {
    const payload = JSON.stringify({
      type: 'sessions',
      sessions: listLiveAdminSessions()
    } satisfies SessionsPayload);

    for (const client of clients) {
      if (client.readyState !== WebSocket.OPEN) continue;
      client.send(payload);
    }
  };

  const startIntervalIfNeeded = () => {
    if (interval) return;
    interval = setInterval(() => {
      if (clients.size === 0) {
        stopIntervalIfIdle();
        return;
      }
      broadcastSessions();
    }, PUSH_INTERVAL_MS);
  };

  wss.on('connection', (ws) => {
    clients.add(ws);
    startIntervalIfNeeded();
    broadcastSessions();

    ws.on('close', () => {
      clients.delete(ws);
      stopIntervalIfIdle();
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

function getPathname(req: IncomingMessage): string {
  try {
    return new URL(req.url ?? '/', 'http://localhost').pathname;
  } catch {
    return '/';
  }
}
