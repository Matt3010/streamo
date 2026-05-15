import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  signal
} from '@angular/core';
import { UserListViewComponent } from '../user-list-view/user-list-view.component';
import { PageHeaderComponent } from '../../ui/page-header/page-header.component';
import { ShareLinksService } from '../../services/share-links.service';
import { LiveSocketService, type LiveSocketController } from '../../services/live-socket.service';
import { watchlistToCardItem } from '../../utils/card-item.util';
import type { CardItem, WatchlistItem } from '../../models';

/* Public /shared/:token page. Fetches the read-only payload and
 * defers to <app-user-list-view> in readonly mode for the actual
 * rendering — the component already knows how to:
 *   - hide every mutation button (readonly flag)
 *   - intercept card clicks with the "Accedi per vedere…" toast
 *   - swap title and empty-state copy when ownerNameOverride is set
 *   - skip its load() pipeline when externalItems is supplied
 *
 * This wrapper only owns the 404 / loading states that sit outside
 * the user-list view's normal responsibility. */
@Component({
  selector: 'app-shared-list-view',
  standalone: true,
  imports: [UserListViewComponent, PageHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (loading()) {
      <app-page-header title="Lista condivisa" [showBack]="false" />
      <div class="loading"><div class="spinner"></div></div>
    } @else if (notFound()) {
      <app-page-header title="Lista condivisa" [showBack]="false" />
      <div class="empty-state">
        <p class="empty-state-title">Link non disponibile</p>
        <p class="empty-state-hint">Il link che hai aperto non esiste più o è stato sospeso dal proprietario.</p>
      </div>
    } @else {
      <app-user-list-view
        kind="watchlist"
        [readonly]="true"
        [externalItems]="items()"
        [ownerNameOverride]="ownerName()" />
    }
  `
})
export class SharedListViewComponent {
  private readonly service = inject(ShareLinksService);
  private readonly liveSocket = inject(LiveSocketService);
  private readonly destroyRef = inject(DestroyRef);

  readonly token = input.required<string>();

  protected readonly loading = signal(true);
  protected readonly notFound = signal(false);
  protected readonly ownerName = signal<string | null>(null);
  protected readonly items = signal<CardItem[]>([]);

  private socket: LiveSocketController | null = null;

  constructor() {
    /* effect() instead of a plain constructor call: the token input
     * is bound from the :token route param by
     * withComponentInputBinding(), which runs AFTER the constructor.
     * Reading an input.required signal in the constructor throws
     * NG0950 silently and leaves the page stuck on the loading
     * spinner forever. */
    effect(() => {
      const token = this.token();
      if (!token) return;
      this.socket?.disconnect();
      void this.load(token);
      this.openSocket(token);
    });

    this.destroyRef.onDestroy(() => {
      this.socket?.disconnect();
      this.socket = null;
    });
  }

  private async load(token: string): Promise<void> {
    this.loading.set(true);
    const data = await this.service.fetchShared(token);
    this.loading.set(false);
    if (!data) {
      this.notFound.set(true);
      /* Token is gone — stop the reconnect loop. The socket would
       * otherwise keep hitting the 404 upgrade and retrying with
       * exponential backoff. */
      this.socket?.disconnect();
      this.socket = null;
      return;
    }
    this.notFound.set(false);
    this.ownerName.set(data.owner.name);
    /* SharedWatchlistItem is a structural subset of WatchlistItem
     * (the extra owner-only fields like resume hints just arrive as
     * undefined here), so the existing mapper works without a
     * dedicated shared variant. */
    this.items.set(data.items.map((row) => watchlistToCardItem(row as WatchlistItem)));
  }

  private openSocket(token: string): void {
    /* The socket forwards watchlist-updated events from the owner's
     * sessions (same userClients map as their own /user/watchlist/ws)
     * and is actively closed by the backend on suspend/delete.
     *   - onMessage → owner changed their watchlist → refetch
     *   - onConnected(false) after a previous true → server-side
     *     close (likely revoke) → refetch to confirm 404
     * If load() returns null we tear the socket down to stop the
     * reconnect loop. */
    let hadOpenConnection = false;
    this.socket = this.liveSocket.create({
      path: `/api/shared/${encodeURIComponent(token)}/ws`,
      onConnected: (connected) => {
        if (connected) {
          hadOpenConnection = true;
        } else if (hadOpenConnection) {
          void this.load(token);
        }
      },
      onMessage: () => {
        void this.load(token);
      }
    });
    this.socket.connect();
  }
}
