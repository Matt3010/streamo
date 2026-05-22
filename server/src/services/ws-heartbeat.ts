import type { IncomingMessage } from 'http';
import { WebSocket } from 'ws';

const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;

export interface WsHeartbeat {
  /** Hook a freshly-upgraded socket: registers pong/close listeners so the
   *  shared interval can ping it and terminate it if it goes silent. */
  trackClient(ws: WebSocket): void;
  /** Tear down the shared interval if every tracked client set is now empty.
   *  Callers invoke this from their own ws.on('close') handler after
   *  removing the closing socket from their per-channel set. */
  clearIntervalIfIdle(): void;
}

/** Factory shared by `user-live` and `admin-live`. Both were carrying the
 *  same WeakMap + setInterval + terminate-if-silent machinery; this collapses
 *  that into one implementation that knows how to enumerate client sets
 *  via the caller-supplied `getClientSets`. */
export function createWsHeartbeat(opts: {
  intervalMs?: number;
  getClientSets: () => Iterable<Set<WebSocket>>;
}): WsHeartbeat {
  const intervalMs = opts.intervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
  const heartbeatState = new WeakMap<WebSocket, boolean>();
  let timer: NodeJS.Timeout | null = null;

  const hasAnyClients = (): boolean => {
    for (const set of opts.getClientSets()) if (set.size > 0) return true;
    return false;
  };

  const beatSet = (clients: Set<WebSocket>): void => {
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
  };

  const ensureInterval = (): void => {
    if (timer) return;
    timer = setInterval(() => {
      for (const set of opts.getClientSets()) beatSet(set);
      clearIntervalIfIdle();
    }, intervalMs);
  };

  const clearIntervalIfIdle = (): void => {
    if (!timer) return;
    if (hasAnyClients()) return;
    clearInterval(timer);
    timer = null;
  };

  const trackClient = (ws: WebSocket): void => {
    heartbeatState.set(ws, true);
    ensureInterval();

    ws.on('pong', () => {
      heartbeatState.set(ws, true);
    });
    ws.on('close', () => {
      heartbeatState.delete(ws);
    });
  };

  return { trackClient, clearIntervalIfIdle };
}

/** Pulls the pathname out of a raw `upgrade` request. Both live-session
 *  modules had the same try/catch boilerplate around `new URL`. */
export function getRequestPathname(req: IncomingMessage): string {
  try {
    return new URL(req.url ?? '/', 'http://localhost').pathname;
  } catch {
    return '/';
  }
}
