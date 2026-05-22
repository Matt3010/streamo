import type { Server as HttpServer } from 'http';
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
import { createWsHeartbeat, getRequestPathname, type WsHeartbeat } from './ws-heartbeat';
import type {
  AuthLogEntry,
  PlaybackLogEntry,
  ProviderResolveLogEntry,
  TransportLogEntry
} from '../../../shared/types';

/** Generic log-service shape — each in-memory log module exposes the
 *  same quartet of functions, just under different names. Adapting them
 *  to this interface at channel-registration time keeps createLogChannel
 *  blind to the specific kind. */
interface LogService<T> {
  list(): T[];
  getCapacity(): number;
  getPath(): string;
  subscribe(fn: () => void): () => void;
}

interface LogChannel {
  path: string;
  wss: WebSocketServer;
  clients: Set<WebSocket>;
}

export function attachAdminLiveSessions(server: HttpServer): void {
  const channels: LogChannel[] = [];

  const heartbeat = createWsHeartbeat({
    getClientSets: function* () {
      for (const ch of channels) yield ch.clients;
    }
  });

  channels.push(
    createLogChannel({
      path: '/admin/auth-logs/ws',
      type: 'auth-logs',
      service: {
        list: listAuthLogs,
        getCapacity: getAuthLogCapacity,
        getPath: getAuthLogPath,
        subscribe: subscribeAuthLogs
      } satisfies LogService<AuthLogEntry>,
      heartbeat
    }),
    createLogChannel({
      path: '/admin/playback-logs/ws',
      type: 'playback-logs',
      service: {
        list: listPlaybackLogs,
        getCapacity: getPlaybackLogCapacity,
        getPath: getPlaybackLogPath,
        subscribe: subscribePlaybackLogs
      } satisfies LogService<PlaybackLogEntry>,
      heartbeat
    }),
    createLogChannel({
      path: '/admin/provider-resolve-logs/ws',
      type: 'provider-resolve-logs',
      service: {
        list: listProviderResolveLogs,
        getCapacity: getProviderResolveLogCapacity,
        getPath: getProviderResolveLogPath,
        subscribe: subscribeProviderResolveLogs
      } satisfies LogService<ProviderResolveLogEntry>,
      heartbeat
    }),
    createLogChannel({
      path: '/admin/transport-logs/ws',
      type: 'transport-logs',
      service: {
        list: listTransportLogs,
        getCapacity: getTransportLogCapacity,
        getPath: getTransportLogPath,
        subscribe: subscribeTransportLogs
      } satisfies LogService<TransportLogEntry>,
      heartbeat
    })
  );

  server.on('upgrade', (req, socket, head) => {
    void (async () => {
      const pathname = getRequestPathname(req);
      const channel = channels.find((c) => c.path === pathname);
      if (!channel) return;

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

      channel.wss.handleUpgrade(req, socket, head, (ws) => {
        channel.wss.emit('connection', ws, req);
      });
    })();
  });
}

/** Wires up one log-stream channel: its own client set, WebSocketServer,
 *  upstream subscription, and broadcast/cleanup machinery. Replaces what
 *  was previously four hand-rolled copies — auth/playback/provider/transport
 *  — that diverged only on naming. */
function createLogChannel<T>(opts: {
  path: string;
  type: string;
  service: LogService<T>;
  heartbeat: WsHeartbeat;
}): LogChannel {
  const clients = new Set<WebSocket>();
  const wss = new WebSocketServer({ noServer: true });
  let unsubscribe: (() => void) | null = null;

  const broadcast = (): void => {
    if (clients.size === 0) {
      clearSubscriptionIfIdle();
      return;
    }
    const logs = opts.service.list();
    const payload = JSON.stringify({
      type: opts.type,
      count: logs.length,
      capacity: opts.service.getCapacity(),
      path: opts.service.getPath(),
      logs
    });
    for (const client of clients) {
      if (client.readyState !== WebSocket.OPEN) continue;
      client.send(payload);
    }
  };

  const ensureSubscription = (): void => {
    if (unsubscribe) return;
    unsubscribe = opts.service.subscribe(() => {
      if (clients.size === 0) return;
      broadcast();
    });
  };

  const clearSubscriptionIfIdle = (): void => {
    if (clients.size > 0 || !unsubscribe) return;
    unsubscribe();
    unsubscribe = null;
  };

  wss.on('connection', (ws) => {
    clients.add(ws);
    opts.heartbeat.trackClient(ws);
    ensureSubscription();
    broadcast();

    ws.on('close', () => {
      clients.delete(ws);
      clearSubscriptionIfIdle();
      opts.heartbeat.clearIntervalIfIdle();
    });
  });

  return { path: opts.path, wss, clients };
}
