import type { IncomingMessage, Server as HttpServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { authenticateToken, readCookie } from '../middleware/auth';
import { createRedisClient, getRedisPublisher, hasRedisConfig } from './redis';
import { createWsHeartbeat, getRequestPathname, type WsHeartbeat } from './ws-heartbeat';
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

/** Wire envelope for cross-process delivery via Redis pub/sub. Always
 *  list-shaped on the wire (notifications, which only target one user
 *  at a time, just send a one-element array). Centralising the shape
 *  keeps the publisher and subscriber agreeing without a per-channel
 *  envelope interface. */
interface UserChannelEnvelope<TPayload> {
  userIds: number[];
  payload: TPayload;
}

interface UserChannel<TPayload> {
  path: string;
  clients: Map<number, Set<WebSocket>>;
  wss: WebSocketServer;
  startSubscription: () => void;
  publish: (userIds: number | number[], payload: TPayload) => void;
}

// Channels are registered with the shared heartbeat so a single 30s
// ping/pong loop sweeps every user-scoped socket — see ws-heartbeat.ts.
// The heartbeat reads the channels array at iteration time, so the
// "create heartbeat first, push channels after" ordering below is fine.
const channels: UserChannel<unknown>[] = [];

const heartbeat = createWsHeartbeat({
  getClientSets: function* () {
    for (const ch of channels) {
      for (const set of ch.clients.values()) yield set;
    }
  }
});

const watchlistChannel = createUserChannel<WatchlistUpdatedEvent>({
  path: USER_WATCHLIST_WS_PATH,
  redisChannel: USER_WATCHLIST_CHANNEL,
  logTag: 'watchlist',
  heartbeat
});
channels.push(watchlistChannel as UserChannel<unknown>);

const notificationsChannel = createUserChannel<NotificationCreatedEvent>({
  path: USER_NOTIFICATIONS_WS_PATH,
  redisChannel: USER_NOTIFICATIONS_CHANNEL,
  logTag: 'notifications',
  heartbeat
});
channels.push(notificationsChannel as UserChannel<unknown>);

export function attachUserLiveSessions(server: HttpServer): void {
  server.on('upgrade', (req, socket, head) => {
    void (async () => {
      const pathname = getRequestPathname(req);
      const channel = channels.find((c) => c.path === pathname);
      if (!channel) return;

      const token = readCookie(req.headers.cookie, 'token');
      const auth = await authenticateToken(token);
      if (!auth.user) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      channel.wss.handleUpgrade(req, socket, head, (ws) => {
        channel.wss.emit('connection', ws, req);
      });
    })();
  });
}

export function startUserWatchlistEventsSubscription(): void {
  watchlistChannel.startSubscription();
}

export function startUserNotificationsSubscription(): void {
  notificationsChannel.startSubscription();
}

export function publishUserWatchlistChanged(
  userIds: number | number[],
  payload: { reason: WatchlistUpdatedEvent['reason']; tmdb_id?: number; media_type?: MediaType }
): void {
  watchlistChannel.publish(userIds, {
    type: 'watchlist-updated',
    ...payload
  });
}

export function publishUserNotificationCreated(userId: number, notification: NotificationItem): void {
  notificationsChannel.publish(userId, {
    type: 'notification-created',
    notification
  });
}

/** Factory shared by both user-scoped WS channels. Owns the per-channel
 *  client map, WSS, Redis subscriber, and publish/deliver logic.
 *  Was three near-identical blocks (start subscription, broadcast,
 *  publish) per channel before — collapsed here so adding a third
 *  channel is one declaration. */
function createUserChannel<TPayload>(opts: {
  path: string;
  redisChannel: string;
  logTag: string;
  heartbeat: WsHeartbeat;
}): UserChannel<TPayload> {
  const clients = new Map<number, Set<WebSocket>>();
  const wss = new WebSocketServer({ noServer: true });
  let subscriberStarted = false;

  const deliver = (userIds: number[], payload: TPayload): void => {
    const message = JSON.stringify(payload);
    for (const userId of userIds) {
      const set = clients.get(userId);
      if (!set?.size) continue;
      for (const client of set) {
        if (client.readyState !== WebSocket.OPEN) continue;
        client.send(message);
      }
    }
  };

  wss.on('connection', (ws, req) => {
    void (async () => {
      const userId = await getUserId(req);
      if (!userId) {
        ws.close();
        return;
      }

      const set = clients.get(userId) ?? new Set<WebSocket>();
      set.add(ws);
      clients.set(userId, set);
      opts.heartbeat.trackClient(ws);

      ws.on('close', () => {
        const current = clients.get(userId);
        if (current) {
          current.delete(ws);
          if (current.size === 0) clients.delete(userId);
        }
        opts.heartbeat.clearIntervalIfIdle();
      });
    })();
  });

  const startSubscription = (): void => {
    if (!hasRedisConfig() || subscriberStarted) return;
    subscriberStarted = true;

    const subscriber = createRedisClient();
    subscriber.on('error', (error) => {
      console.error(`[user-live-subscriber:${opts.logTag}]`, error);
    });
    subscriber.on('message', (channel, message) => {
      try {
        if (channel === opts.redisChannel) {
          const parsed = JSON.parse(message) as UserChannelEnvelope<TPayload>;
          deliver(parsed.userIds, parsed.payload);
        }
      } catch (error) {
        console.error(`[user-live-subscriber:${opts.logTag}] invalid payload`, error);
      }
    });

    void subscriber.subscribe(opts.redisChannel).catch((error) => {
      console.error(`[user-live-subscriber:${opts.logTag}] subscribe failed`, error);
      subscriber.disconnect();
      subscriberStarted = false;
    });
  };

  const publish = (userIds: number | number[], payload: TPayload): void => {
    const ids = Array.isArray(userIds) ? userIds : [userIds];
    if (!hasRedisConfig()) {
      // Single-process dev mode: deliver inline so the dev flow doesn't
      // require Redis to see WS events round-trip.
      deliver(ids, payload);
      return;
    }
    const envelope: UserChannelEnvelope<TPayload> = { userIds: ids, payload };
    void getRedisPublisher().publish(opts.redisChannel, JSON.stringify(envelope)).catch((error) => {
      console.error(`[user-live-publisher:${opts.logTag}]`, error);
    });
  };

  return { path: opts.path, clients, wss, startSubscription, publish };
}

async function getUserId(req: IncomingMessage): Promise<number | null> {
  const token = readCookie(req.headers.cookie, 'token');
  const auth = await authenticateToken(token);
  return auth.user?.id ?? null;
}
