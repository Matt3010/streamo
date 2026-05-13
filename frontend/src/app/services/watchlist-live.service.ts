import { Injectable, effect, inject } from '@angular/core';
import { AuthService } from './auth.service';
import { LiveSocketService, type LiveSocketController } from './live-socket.service';
import { WatchlistService } from './watchlist.service';
import type { WatchlistUpdatedEvent } from '../models';

@Injectable({ providedIn: 'root' })
export class WatchlistLiveService {
  private readonly auth = inject(AuthService);
  private readonly liveSocket = inject(LiveSocketService);
  private readonly watchlist = inject(WatchlistService);
  private readonly controller: LiveSocketController = this.liveSocket.create({
    path: '/api/user/watchlist/ws',
    onConnected: () => {},
    onMessage: (event) => {
      try {
        const payload = JSON.parse(event.data as string) as WatchlistUpdatedEvent;
        if (payload.type !== 'watchlist-updated') return;
        if (payload.reason === 'folder-changed') return;
        this.watchlist.notifyExternalUpdate();
      } catch {
        // Ignore malformed messages and keep the socket alive.
      }
    }
  });

  constructor() {
    effect(() => {
      const resolved = this.auth.authResolved();
      const user = this.auth.currentUser();

      if (!resolved) return;
      if (!user) {
        this.controller.disconnect();
        return;
      }

      this.controller.connect();
    });
  }
}
