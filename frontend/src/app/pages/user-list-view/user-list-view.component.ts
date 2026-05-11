import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { CardComponent } from '../../components/card/card.component';
import { IconComponent } from '../../ui/icon/icon.component';
import { ConfirmModalComponent } from '../../ui/confirm-modal/confirm-modal.component';
import { UiTabsComponent, UiTab } from '../../ui/tabs/tabs.component';
import { AuthService } from '../../services/auth.service';
import { TmdbService } from '../../services/tmdb.service';
import { WatchlistService } from '../../services/watchlist.service';
import { HistoryService } from '../../services/history.service';
import { ToastService } from '../../services/toast.service';
import { NavigationSourceService } from '../../services/navigation-source.service';
import { enrichCardsWithTmdb } from '../../utils/card-item.util';
import { applyWatchlistFlags, setCardWatchlistFlag, toggleCardWatchlist } from '../../utils/card-watchlist.util';
import type { CardItem, WatchlistStatus } from '../../models';

export type UserListType = 'watchlist' | 'history';
export type ViewMode = 'grid' | 'list';
type MediaFilter = 'all' | 'tv' | 'movie';
type BackendMediaFilter = Exclude<MediaFilter, 'all'>;
type PendingAction =
  | { type: 'remove-item'; item: CardItem }
  | { type: 'remove-watchlist'; item: CardItem };

const VIEW_MODE_KEY = 'vixstream.user-list.view-mode';

const STATUS_TABS: ReadonlyArray<UiTab<WatchlistStatus>> = [
  { value: 'todo', label: 'Da guardare' },
  { value: 'done', label: 'Visto' }
];

const MEDIA_TABS: ReadonlyArray<UiTab<MediaFilter>> = [
  { value: 'all', label: 'Tutti' },
  { value: 'tv', label: 'TV' },
  { value: 'movie', label: 'Film' }
];

@Component({
  selector: 'app-user-list-view',
  standalone: true,
  imports: [CardComponent, IconComponent, ConfirmModalComponent, UiTabsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-header">
      <div class="page-header-back">
        <button class="back-btn" (click)="back()">
          <app-icon name="chevron-left"></app-icon>
          <span>Indietro</span>
        </button>
      </div>
      <div class="page-header-row">
        <h2>{{ title() }}</h2>
        <div class="page-actions">
          <div class="view-toggle" role="group" aria-label="Modalita visualizzazione">
            <button class="view-btn" [class.active]="viewMode() === 'grid'"
                    aria-label="Griglia" (click)="setViewMode('grid')">
              <app-icon name="grid"></app-icon>
            </button>
            <button class="view-btn" [class.active]="viewMode() === 'list'"
                    aria-label="Lista" (click)="setViewMode('list')">
              <app-icon name="list"></app-icon>
            </button>
          </div>
        </div>
      </div>
    </div>

    <div class="filter-bar">
      @if (kind() === 'watchlist') {
        <ui-tabs [tabs]="statusTabs" [(value)]="statusFilter" />
      }
      <ui-tabs [tabs]="mediaTabs" [(value)]="mediaFilter" />
    </div>

    @if (loading()) {
      <div class="loading"><div class="spinner"></div></div>
    } @else if (filteredItems().length === 0) {
      <div class="empty-state">
        <p class="empty-state-title">{{ emptyTitle() }}</p>
        <p class="empty-state-hint">{{ emptyHint() }}</p>
      </div>
    } @else if (viewMode() === 'grid') {
      <div class="content-grid">
        @for (it of filteredItems(); track it.tmdb_id + '-' + it.media_type) {
          <app-card
            [item]="it"
            [showRemove]="true"
            [showProgress]="true"
            [showStatusToggle]="kind() === 'watchlist'"
            [showWatchlistToggle]="kind() === 'history' && auth.isLoggedIn()"
            (cardClick)="onCardClick($event)"
            (watchlistToggleClick)="onWatchlistToggle($event)"
            (statusToggleClick)="onStatusToggle($event)"
            (removeClick)="onRemoveClick($event)" />
        }
      </div>
    } @else {
      <ul class="item-list">
        @for (it of filteredItems(); track it.tmdb_id + '-' + it.media_type) {
          <li class="item-row" (click)="onCardClick(it)">
            <span class="item-type">{{ it.media_type === 'tv' ? 'TV' : 'Film' }}</span>
            <div class="item-info">
              <span class="item-title">{{ it.title }}</span>
              @if (it.season && it.episode || it.watchStatus || it.nextReleaseText) {
                <span class="item-sub">
                  @if (it.season && it.episode) {
                    <span class="item-meta">S{{ it.season }} E{{ it.episode }}</span>
                  }
                  @if (it.watchStatus) {
                    <span class="item-watch-status">{{ it.watchStatus }}</span>
                  }
                  @if (it.nextReleaseText) {
                    <span class="item-release-status">{{ it.nextReleaseText }}</span>
                  }
                </span>
              }
            </div>
            @if (kind() === 'watchlist' && !it.isUpcoming) {
              <button class="row-action row-status"
                      [class.done]="it.status === 'done'"
                      [title]="it.status === 'done' ? 'Segna da guardare' : 'Segna come visto'"
                      (click)="onStatusToggle(it); $event.stopPropagation()">
                <app-icon name="check"></app-icon>
              </button>
            }
            @if (kind() === 'history' && auth.isLoggedIn()) {
              <button class="row-action row-watchlist"
                      [class.active]="it.inWatchlist === true"
                      [title]="it.inWatchlist ? 'Rimuovi dalla lista' : 'Aggiungi alla lista'"
                      (click)="onWatchlistToggle(it); $event.stopPropagation()">
                <app-icon name="bookmark"></app-icon>
              </button>
            }
            <button class="row-action row-remove"
                    [title]="kind() === 'watchlist' ? 'Rimuovi dalla lista' : 'Rimuovi dalla cronologia'"
                    (click)="onRemoveClick(it); $event.stopPropagation()">
              <app-icon name="trash"></app-icon>
            </button>
          </li>
        }
      </ul>
    }

    <ui-confirm-modal
      [(open)]="confirmModalOpen"
      [title]="confirmModalTitle()"
      [message]="confirmModalMessage()"
      [warning]="confirmModalWarning()"
      [actionLabel]="confirmModalActionLabel()"
      (cancelled)="pendingAction.set(null)"
      (confirmed)="confirmPendingAction()" />
  `,
  styleUrl: './user-list-view.component.css'
})
export class UserListViewComponent {
  protected readonly auth = inject(AuthService);
  private readonly tmdb = inject(TmdbService);
  private readonly watchlist = inject(WatchlistService);
  private readonly history = inject(HistoryService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly navSource = inject(NavigationSourceService);

  readonly kind = input.required<UserListType>();

  protected readonly statusTabs = STATUS_TABS;
  protected readonly mediaTabs = MEDIA_TABS;
  protected readonly statusFilter = signal<WatchlistStatus>('todo');
  protected readonly mediaFilter = signal<MediaFilter>('all');
  protected readonly viewMode = signal<ViewMode>(loadViewMode());

  protected readonly items = signal<CardItem[]>([]);
  protected readonly loading = signal(false);
  protected readonly confirmModalOpen = signal(false);
  protected readonly pendingAction = signal<PendingAction | null>(null);
  protected readonly title = computed(() => this.kind() === 'watchlist' ? 'La mia lista' : 'Cronologia');

  protected readonly filteredItems = computed(() => this.items());

  protected readonly emptyTitle = computed(() => {
    const media = this.mediaFilter();
    if (this.kind() !== 'watchlist') {
      return media === 'all'
        ? 'La cronologia è vuota'
        : `Nessun ${mediaLabel(media)} nella cronologia`;
    }
    if (this.statusFilter() === 'done') {
      return media === 'all'
        ? 'Nessun titolo segnato come visto'
        : `Nessun ${mediaLabel(media)} segnato come visto`;
    }
    return media === 'all'
      ? 'La tua lista è vuota'
      : `Nessun ${mediaLabel(media)} nella tua lista`;
  });

  protected readonly emptyHint = computed(() => {
    const media = this.mediaFilter();
    if (this.kind() !== 'watchlist') {
      return media === 'all'
        ? 'I titoli che inizi a guardare verranno tracciati qui.'
        : `Prova a cambiare filtro o inizia a guardare ${mediaHintTarget(media)}.`;
    }
    if (this.statusFilter() === 'done') {
      return 'I titoli che marchi come visti dal pulsante check appariranno qui.';
    }
    return `Apri ${mediaHintTarget(media)} e clicca il segnalibro per aggiungerl${media === 'tv' ? 'a' : 'o'} alla tua lista.`;
  });

  protected readonly confirmModalTitle = computed(() => {
    const action = this.pendingAction();
    if (!action) return 'Conferma';
    if (action.type === 'remove-watchlist') return 'Rimuovi Dalla Lista';
    return this.kind() === 'watchlist' ? 'Rimuovi Dalla Lista' : 'Rimuovi Dalla Cronologia';
  });

  protected readonly confirmModalMessage = computed(() => {
    const action = this.pendingAction();
    const item = action?.item;
    if (!item) return '';
    if (action.type === 'remove-watchlist') {
      return `Vuoi rimuovere ${item.title} dalla tua lista?`;
    }
    return this.kind() === 'watchlist'
      ? `Vuoi rimuovere ${item.title} dalla tua lista?`
      : `Vuoi rimuovere ${item.title} dalla cronologia?`;
  });

  protected readonly confirmModalWarning = computed(() => {
    const action = this.pendingAction();
    if (!action) return '';
    if (action.type === 'remove-watchlist') return 'Potrai sempre riaggiungerlo più tardi.';
    return this.kind() === 'watchlist'
      ? 'Potrai sempre riaggiungerlo più tardi.'
      : 'Questa voce sparirà dalla cronologia.';
  });

  protected readonly confirmModalActionLabel = computed(() => 'Rimuovi');

  private seq = 0;

  constructor() {
    effect(() => {
      const kind = this.kind();
      const media = this.mediaFilter();
      const status = kind === 'watchlist' ? this.statusFilter() : undefined;
      this.auth.currentUser();
      if (kind === 'history') this.watchlist.tick();
      void this.load(kind, media, status);
    });
  }

  protected setViewMode(mode: ViewMode): void {
    this.viewMode.set(mode);
    try { localStorage.setItem(VIEW_MODE_KEY, mode); } catch { /* storage unavailable */ }
  }

  protected back(): void {
    this.navSource.goBack('/browse');
  }

  protected onCardClick(item: CardItem): void {
    const queryParams: Record<string, number> = {};
    if (item.season) queryParams['s'] = item.season;
    if (item.episode) queryParams['e'] = item.episode;
    void this.router.navigate(['/watch', item.media_type, item.tmdb_id], { queryParams });
  }

  protected async onRemoveClick(item: CardItem): Promise<void> {
    this.pendingAction.set({ type: 'remove-item', item });
    this.confirmModalOpen.set(true);
  }

  protected async onStatusToggle(item: CardItem): Promise<void> {
    if (this.kind() !== 'watchlist') return;
    const next: WatchlistStatus = (item.status ?? 'todo') === 'done' ? 'todo' : 'done';
    await this.watchlist.setStatus(item.tmdb_id, item.media_type, next);
    this.toast.show(next === 'done'
      ? `${item.title}: segnato come visto`
      : `${item.title}: rimesso in "Da guardare"`);
    void this.load(this.kind(), this.mediaFilter(), this.statusFilter());
  }

  protected async onWatchlistToggle(item: CardItem): Promise<void> {
    if (this.kind() !== 'history' || !this.auth.isLoggedIn()) return;
    if (item.inWatchlist) {
      this.pendingAction.set({ type: 'remove-watchlist', item });
      this.confirmModalOpen.set(true);
      return;
    }
    const result = await toggleCardWatchlist(item, this.watchlist);
    this.items.update((items) => setCardWatchlistFlag(items, item, result.inWatchlist));
    this.toast.show(result.message);
  }

  protected async confirmPendingAction(): Promise<void> {
    const action = this.pendingAction();
    this.pendingAction.set(null);
    if (!action) return;

    if (action.type === 'remove-watchlist') {
      await this.watchlist.remove(action.item.tmdb_id, action.item.media_type);
      this.items.update((items) => setCardWatchlistFlag(items, action.item, false));
      this.toast.show(`${action.item.title}: rimosso dalla lista`);
      return;
    }

    const item = action.item;
    if (this.kind() === 'watchlist') {
      await this.watchlist.remove(item.tmdb_id, item.media_type);
      this.toast.show(`${item.title}: rimosso dalla lista`);
    } else {
      await this.history.remove(item.tmdb_id, item.media_type);
      this.toast.show(`${item.title}: rimosso dalla cronologia`);
    }
    this.items.update(arr => arr.filter(i => !(i.tmdb_id === item.tmdb_id && i.media_type === item.media_type)));
  }

  private async load(kind: UserListType, media: MediaFilter, status?: WatchlistStatus): Promise<void> {
    const mySeq = ++this.seq;
    this.loading.set(true);
    this.items.set([]);
    const mediaType = media === 'all' ? undefined : media as BackendMediaFilter;
    if (kind === 'watchlist') {
      const list = await this.watchlist.list({ status, ...(mediaType ? { media_type: mediaType } : {}) });
      if (mySeq !== this.seq) return;
      const items = await enrichCardsWithTmdb(list.map(w => ({
        tmdb_id: w.tmdb_id,
        media_type: w.media_type,
        title: w.title ?? 'Senza titolo',
        poster: w.poster,
        status: w.status ?? 'todo',
        watchStatus: w.watch_status_text,
        season: w.resume_season,
        episode: w.resume_episode,
        position: w.position,
        duration: w.duration
      })), this.tmdb, { releaseTextMode: 'all' });
      if (mySeq !== this.seq) return;
      this.items.set(items);
    } else {
      const [list, watchlist] = await Promise.all([
        this.history.list(mediaType ? { media_type: mediaType } : undefined),
        this.watchlist.list()
      ]);
      if (mySeq !== this.seq) return;
      const items = await enrichCardsWithTmdb(applyWatchlistFlags(list.map(h => ({
        tmdb_id: h.tmdb_id,
        media_type: h.media_type,
        title: h.title ?? 'Senza titolo',
        poster: h.poster,
        season: h.season,
        episode: h.episode
      })), watchlist), this.tmdb, { releaseTextMode: 'all' });
      if (mySeq !== this.seq) return;
      this.items.set(items);
    }
    this.loading.set(false);
  }
}

function loadViewMode(): ViewMode {
  try {
    const v = localStorage.getItem(VIEW_MODE_KEY);
    return v === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
}

function mediaLabel(filter: MediaFilter): string {
  return filter === 'tv' ? 'serie TV' : filter === 'movie' ? 'film' : 'titolo';
}

function mediaHintTarget(filter: MediaFilter): string {
  if (filter === 'tv') return 'una serie TV';
  if (filter === 'movie') return 'un film';
  return 'un film o una serie';
}
