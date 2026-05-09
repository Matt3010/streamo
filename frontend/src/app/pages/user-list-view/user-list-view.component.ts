import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { CardComponent } from '../../components/card/card.component';
import { IconComponent } from '../../components/icon/icon.component';
import { UiTabsComponent, UiTab } from '../../ui/tabs/tabs.component';
import { WatchlistService } from '../../services/watchlist.service';
import { HistoryService } from '../../services/history.service';
import { ToastService } from '../../services/toast.service';
import { NavigationSourceService } from '../../services/navigation-source.service';
import type { CardItem, WatchlistStatus } from '../../models';

export type UserListType = 'watchlist' | 'history';
export type ViewMode = 'grid' | 'list';

const VIEW_MODE_KEY = 'vixstream.user-list.view-mode';

const STATUS_TABS: ReadonlyArray<UiTab<WatchlistStatus>> = [
  { value: 'todo', label: 'Da guardare' },
  { value: 'done', label: 'Visto' }
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

    @if (kind() === 'watchlist') {
      <div class="filter-bar">
        <ui-tabs [tabs]="statusTabs" [(value)]="statusFilter" />
      </div>
    }

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
  private readonly watchlist = inject(WatchlistService);
  private readonly history = inject(HistoryService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly navSource = inject(NavigationSourceService);

  // Route :kind param via withComponentInputBinding().
  readonly kind = input.required<UserListType>();

  protected readonly statusTabs = STATUS_TABS;
  protected readonly statusFilter = signal<WatchlistStatus>('todo');
  protected readonly viewMode = signal<ViewMode>(loadViewMode());

  protected readonly items = signal<CardItem[]>([]);
  protected readonly loading = signal(false);
  protected readonly title = computed(() => this.kind() === 'watchlist' ? 'La mia lista' : 'Cronologia');

  // Watchlist gets status-filtered; history shows everything.
  protected readonly filteredItems = computed(() => {
    const all = this.items();
    if (this.kind() !== 'watchlist') return all;
    const want = this.statusFilter();
    return all.filter(it => (it.status ?? 'todo') === want);
  });

  protected readonly emptyTitle = computed(() => {
    if (this.kind() !== 'watchlist') return 'La cronologia è vuota';
    return this.statusFilter() === 'done' ? 'Nessun titolo segnato come visto' : 'La tua lista è vuota';
  });

  protected readonly emptyHint = computed(() => {
    if (this.kind() !== 'watchlist') {
      return 'I titoli che inizi a guardare verranno tracciati qui.';
    }
    return this.statusFilter() === 'done'
      ? 'I titoli che marchi come visti dal pulsante ✓ appariranno qui.'
      : 'Apri un film o una serie e clicca il segnalibro per aggiungerlo alla tua lista.';
  });

  private seq = 0;

  constructor() {
    effect(() => {
      const kind = this.kind();
      void this.load(kind);
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
    // Re-fetch so the backend can recompute the resolved watchlist view-model
    // (resume target, badge text, and effective done/todo state).
    void this.load(this.kind());
  }

  private async load(kind: UserListType): Promise<void> {
    const mySeq = ++this.seq;
    this.loading.set(true);
    this.items.set([]);
    if (kind === 'watchlist') {
      const list = await this.watchlist.list();
      if (mySeq !== this.seq) return;
      this.items.set(list.map(w => ({
        tmdb_id: w.tmdb_id, media_type: w.media_type,
        title: w.title ?? 'Senza titolo', poster: w.poster,
        status: w.status ?? 'todo',
        watchStatus: w.watch_status_text,
        season: w.resume_season,
        episode: w.resume_episode,
        position: w.position,
        duration: w.duration
      })));
    } else {
      const list = await this.history.list();
      if (mySeq !== this.seq) return;
      this.items.set(list.map(h => ({
        tmdb_id: h.tmdb_id, media_type: h.media_type,
        title: h.title ?? 'Senza titolo', poster: h.poster,
        season: h.season, episode: h.episode
      })));
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
