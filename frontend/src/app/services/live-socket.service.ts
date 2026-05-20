import { Injectable } from '@angular/core';

export interface LiveSocketController {
  connect(): void;
  disconnect(): void;
}

interface LiveSocketOptions {
  path: string;
  onConnected: (connected: boolean) => void;
  onMessage: (event: MessageEvent, socket: WebSocket) => void;
}

const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 15000;

@Injectable({ providedIn: 'root' })
export class LiveSocketService {
  create(options: LiveSocketOptions): LiveSocketController {
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempts = 0;
    let shouldReconnect = false;

    const clearReconnectTimer = (): void => {
      if (!reconnectTimer) return;
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    };

    const scheduleReconnect = (): void => {
      if (!shouldReconnect || reconnectTimer) return;
      const delayMs = Math.min(
        RECONNECT_MAX_DELAY_MS,
        RECONNECT_BASE_DELAY_MS * Math.max(1, 2 ** reconnectAttempts)
      );
      reconnectAttempts += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delayMs);
    };

    /* When the tab returns to foreground after sleep, the backoff counter
     * may have grown to the 15s ceiling. Reset it and re-attempt immediately
     * so the user sees fresh data instead of waiting out the old delay. */
    const onVisibilityChange = (): void => {
      if (document.visibilityState !== 'visible') return;
      if (!shouldReconnect) return;
      if (socket && socket.readyState === WebSocket.OPEN) return;
      reconnectAttempts = 0;
      clearReconnectTimer();
      connect();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    const connect = (): void => {
      clearReconnectTimer();

        if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
          return;
        }

        const current = new WebSocket(this.toWebSocketUrl(options.path));
        socket = current;

        current.addEventListener('open', () => {
          if (socket !== current) return;
          reconnectAttempts = 0;
          options.onConnected(true);
        });

        current.addEventListener('message', (event) => {
          if (socket !== current) return;
          options.onMessage(event, current);
        });

        current.addEventListener('close', () => {
          if (socket !== current) return;
          options.onConnected(false);
          socket = null;
          scheduleReconnect();
        });

        current.addEventListener('error', () => {
          if (socket !== current) return;
          options.onConnected(false);
        });
    };

    return {
      connect: () => {
        shouldReconnect = true;
        connect();
      },
      disconnect: () => {
        shouldReconnect = false;
        reconnectAttempts = 0;
        clearReconnectTimer();
        document.removeEventListener('visibilitychange', onVisibilityChange);
        options.onConnected(false);
        if (!socket) return;
        const current = socket;
        socket = null;
        current.close();
      }
    };
  }

  private toWebSocketUrl(path: string): string {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}${path}`;
  }
}
