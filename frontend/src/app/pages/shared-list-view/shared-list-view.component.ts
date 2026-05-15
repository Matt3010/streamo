import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  signal
} from '@angular/core';
import { UserListViewComponent } from '../user-list-view/user-list-view.component';
import { PageHeaderComponent } from '../../ui/page-header/page-header.component';
import { ShareLinksService } from '../../services/share-links.service';
import type { CardItem, MediaType } from '../../models';
import type { SharedWatchlistItem } from '../../../../../shared/types';

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

  readonly token = input.required<string>();

  protected readonly loading = signal(true);
  protected readonly notFound = signal(false);
  protected readonly ownerName = signal<string | null>(null);
  protected readonly items = signal<CardItem[]>([]);

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
      void this.load(token);
    });
  }

  private async load(token: string): Promise<void> {
    this.loading.set(true);
    const data = await this.service.fetchShared(token);
    this.loading.set(false);
    if (!data) {
      this.notFound.set(true);
      return;
    }
    this.ownerName.set(data.owner.name);
    this.items.set(data.items.map(sharedToCardItem));
  }
}

function sharedToCardItem(row: SharedWatchlistItem): CardItem {
  return {
    tmdb_id: row.tmdb_id,
    media_type: row.media_type as MediaType,
    title: row.title ?? 'Senza titolo',
    poster: row.poster,
    folderName: row.folder_name ?? undefined,
    status: row.status
  };
}
