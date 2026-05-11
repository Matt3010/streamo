import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { CardComponent } from '../../components/card/card.component';
import { IconComponent } from '../../ui/icon/icon.component';
import { UiTabsComponent, UiTab } from '../../ui/tabs/tabs.component';
import { TmdbService } from '../../services/tmdb.service';
import { WatchlistService } from '../../services/watchlist.service';
import { HistoryService } from '../../services/history.service';
import { ToastService } from '../../services/toast.service';
import { NavigationSourceService } from '../../services/navigation-source.service';
import type { CardItem, WatchlistStatus } from '../../models';

export type UserListType = 'watchlist' | 'history';
export type ViewMode = 'grid' | 'list';
type MediaFilter = 'all' | 'tv' | 'movie';
type BackendMediaFilter = Exclude<MediaFilter, 'all'>;

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
  imports: [CardComponent, IconComponent, UiTabsComponent],
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
            (cardClick)="onCardClick($event)"
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
              @if (it.season && it.episode || it.watchStatus) {
                <span class="item-sub">
                  @if (it.season && it.episode) {
                    <span class="item-meta">S{{ it.season }} E{{ it.episode }}</span>
                  }
                  @if (it.watchStatus) {
                    <span class="item-watch-status">{{ it.watchStatus }}</span>
                  }
                </span>
              }
            </div>
            @if (kind() === 'watchlist') {
              <button class="row-action row-status"
                      [class.done]="it.status === 'done'"
                      [title]="it.status === 'done' ? 'Segna da guardare' : 'Segna come visto'"
                      (click)="onStatusToggle(it); $event.stopPropagation()">
                <app-icon name="check"></app-icon>
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
  `,
  styleUrl: './user-list-view.component.css'
})
export class UserListViewComponent {
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

  private seq = 0;

  constructor() {
    effect(() => {
      const kind = this.kind();
      const media = this.mediaFilter();
      const status = kind === 'watchlist' ? this.statusFilter() : undefined;
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
    if (this.kind() === 'watchlist') {
      await this.watchlist.remove(item.tmdb_id, item.media_type);
      this.toast.show(`${item.title}: rimosso dalla lista`);
    } else {
      await this.history.remove(item.tmdb_id, item.media_type);
      this.toast.show(`${item.title}: rimosso dalla cronologia`);
    }
    this.items.update(arr => arr.filter(i => !(i.tmdb_id === item.tmdb_id && i.media_type === item.media_type)));
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
      })), this.tmdb);
      if (mySeq !== this.seq) return;
      this.items.set(items);
    } else {
      const list = await this.history.list(mediaType ? { media_type: mediaType } : undefined);
      if (mySeq !== this.seq) return;
      const items = await enrichCardsWithTmdb(list.map(h => ({
        tmdb_id: h.tmdb_id,
        media_type: h.media_type,
        title: h.title ?? 'Senza titolo',
        poster: h.poster,
        season: h.season,
        episode: h.episode
      })), this.tmdb);
      if (mySeq !== this.seq) return;
      this.items.set(items);
    }
    this.loading.set(false);
  }
}

async function enrichCardsWithTmdb(items: CardItem[], tmdb: TmdbService): Promise<CardItem[]> {
  return Promise.all(items.map(async (item) => {
    const details = await tmdb.getDetails(item.tmdb_id, item.media_type);
    if (!details) return item;
    return {
      ...item,
      popularity: details.popularity,
      voteCount: details.vote_count,
      rating: item.rating ?? (details.vote_average ? details.vote_average.toFixed(1) : ''),
      year: item.year ?? (details.release_date ?? details.first_air_date ?? '').split('-')[0] ?? ''
    };
  }));
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
