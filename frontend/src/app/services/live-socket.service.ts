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

@Injectable({ providedIn: 'root' })
export class LiveSocketService {
  create(options: LiveSocketOptions): LiveSocketController {
    let socket: WebSocket | null = null;

    return {
      connect: () => {
        if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
          return;
        }

        const current = new WebSocket(this.toWebSocketUrl(options.path));
        socket = current;

        current.addEventListener('open', () => {
          if (socket !== current) return;
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
        });

        current.addEventListener('error', () => {
          if (socket !== current) return;
          options.onConnected(false);
        });
      },

      disconnect: () => {
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
