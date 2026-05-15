import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal
} from '@angular/core';
import { Router } from '@angular/router';
import { CardComponent } from '../../components/card/card.component';
import { ShareLinksService } from '../../services/share-links.service';
import { ToastService } from '../../services/toast.service';
import { UiTabsComponent, type UiTab } from '../../ui/tabs/tabs.component';
import { PageHeaderComponent } from '../../ui/page-header/page-header.component';
import type { CardItem, MediaType } from '../../models';
import type { SharedWatchlistItem } from '../../../../../shared/types';

type MediaFilter = 'all' | 'tv' | 'movie';

const MEDIA_TABS: ReadonlyArray<UiTab<MediaFilter>> = [
  { value: 'all', label: 'Tutti' },
  { value: 'tv', label: 'TV' },
  { value: 'movie', label: 'Film' }
];

/* Public read-only view of someone else's watchlist. Reuses
 * <app-card> for individual items so the visual matches the rest of
 * the app, but skips the full UserListViewComponent (which is heavily
 * auth-coupled and would need ~20 readonly branches throughout). The
 * recipient can scroll, filter by media type, and visually inspect
 * cards; clicking a card does not navigate anywhere because /watch
 * is auth-gated. */
@Component({
  selector: 'app-shared-list-view',
  standalone: true,
  imports: [CardComponent, UiTabsComponent, PageHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './shared-list-view.component.css',
  template: `
    <app-page-header [title]="title()" [showBack]="false" />

    @if (loading()) {
      <div class="loading"><div class="spinner"></div></div>
    } @else if (notFound()) {
      <div class="empty-state">
        <p class="empty-state-title">Link non disponibile</p>
        <p class="empty-state-hint">Il link che hai aperto non esiste più o è stato sospeso dal proprietario.</p>
      </div>
    } @else {
      <div class="filter-bar">
        <ui-tabs [tabs]="mediaTabs" [(value)]="mediaFilter" />
      </div>

      @if (visibleItems().length === 0) {
        <div class="empty-state">
          <p class="empty-state-title">Nessun titolo</p>
          <p class="empty-state-hint">La lista è vuota per il filtro selezionato.</p>
        </div>
      } @else {
        <div class="content-grid shared-grid">
          @for (item of visibleItems(); track item.tmdb_id + '-' + item.media_type) {
            <app-card
              [item]="item"
              [showRemove]="false"
              [showStatusToggle]="false"
              [showWatchlistToggle]="false"
              [showFolderAction]="false"
              (cardClick)="onCardClick()" />
          }
        </div>
      }
    }
  `
})
export class SharedListViewComponent {
  private readonly service = inject(ShareLinksService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  readonly token = input.required<string>();

  protected readonly mediaTabs = MEDIA_TABS;
  protected readonly mediaFilter = signal<MediaFilter>('all');
  protected readonly loading = signal(true);
  protected readonly notFound = signal(false);
  protected readonly ownerName = signal<string | null>(null);
  protected readonly items = signal<CardItem[]>([]);

  protected readonly title = computed(() => {
    const owner = this.ownerName();
    return owner ? `Lista di ${owner}` : 'Lista condivisa';
  });

  protected readonly visibleItems = computed(() => {
    const filter = this.mediaFilter();
    if (filter === 'all') return this.items();
    return this.items().filter((item) => item.media_type === filter);
  });

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    const token = this.token();
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

  protected onCardClick(): void {
    /* Clicking a card in shared mode does not navigate — /watch is
     * auth-gated, so a click would just kick the recipient to the
     * login screen. Surface a friendly toast instead. */
    this.toast.show('Accedi per vedere il dettaglio del titolo');
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
