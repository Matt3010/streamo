import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { CardComponent } from '../../components/card/card.component';
import { IconComponent } from '../../components/icon/icon.component';
import { UiTabsComponent, UiTab } from '../../ui/tabs/tabs.component';
import { UiModalComponent } from '../../ui/modal/modal.component';
import { WatchlistService } from '../../services/watchlist.service';
import { HistoryService } from '../../services/history.service';
import { ToastService } from '../../services/toast.service';
import { NavigationSourceService } from '../../services/navigation-source.service';
import { computeWatchStatus } from '../../services/watchlist-status.util';
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
  imports: [CardComponent, IconComponent, UiTabsComponent, UiModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-header">
      <button class="back-btn" (click)="back()">
        <app-icon name="chevron-left"></app-icon>
        <span>Indietro</span>
      </button>
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
            [showMarkProgress]="kind() === 'watchlist' && it.media_type === 'tv'"
            (cardClick)="onCardClick($event)"
            (statusToggleClick)="onStatusToggle($event)"
            (removeClick)="onRemoveClick($event)"
            (markProgressClick)="openMarkModal($event)" />
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
            @if (kind() === 'watchlist' && it.media_type === 'tv') {
              <button class="row-action row-mark" title="Segna progresso"
                      (click)="openMarkModal(it); $event.stopPropagation()">
                <app-icon name="pen"></app-icon>
              </button>
            }
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

    <ui-modal [(open)]="markOpen"
              [title]="markItem() ? 'Segna fino a (' + markItem()!.title + ')' : 'Segna progresso'"
              size="sm"
              (closed)="onMarkClosed()">
      <form class="mark-form" (submit)="submitMark($event)">
        <label>
          <span>Stagione</span>
          <input type="number" min="1" required
                 [max]="markItem()?.totalSeasons ?? 99"
                 [value]="markSeason()" (input)="updateSeason($event)">
        </label>
        <label>
          <span>Episodio</span>
          <input type="number" min="1" required
                 [max]="markEpisodeMax()"
                 [value]="markEpisode()" (input)="updateEpisode($event)">
        </label>
        @if (markError()) { <p class="mark-error">{{ markError() }}</p> }
        <button type="submit" class="primary-btn" [disabled]="markSubmitting()">
          {{ markSubmitting() ? 'Salvataggio...' : 'Conferma' }}
        </button>
        <button type="button" class="secondary-btn" [disabled]="markSubmitting()"
                (click)="markAll()">
          L'ho visto tutto
        </button>
      </form>
    </ui-modal>
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

  // Mark-progress modal state
  protected readonly markOpen = signal(false);
  protected readonly markItem = signal<CardItem | null>(null);
  protected readonly markSeason = signal(1);
  protected readonly markEpisode = signal(1);
  protected readonly markSubmitting = signal(false);
  protected readonly markError = signal('');

  // Episode max for the chosen season (from TMDB-cached seasons array).
  protected readonly markEpisodeMax = computed(() => {
    const item = this.markItem();
    const season = this.markSeason();
    const found = item?.seasons?.find(s => s.season_number === season);
    return found?.episode_count ?? 99;
  });

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
    this.navSource.goBack('/browse/movie');
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
    // Re-fetch so watched_count + watchStatus reflect the new progress that
    // the backend inserted alongside status='done'. (Going to 'todo' wipes
    // progress; reloading keeps the badge consistent.)
    void this.load(this.kind());
  }

  protected openMarkModal(item: CardItem): void {
    this.markItem.set(item);
    // Pre-fill with the user's current progress so the inputs reflect reality.
    this.markSeason.set(item.lastSeason && item.lastSeason > 0 ? item.lastSeason : 1);
    this.markEpisode.set(item.lastEpisode && item.lastEpisode > 0 ? item.lastEpisode : 1);
    this.markError.set('');
    this.markOpen.set(true);
  }

  protected onMarkClosed(): void {
    this.markItem.set(null);
    this.markError.set('');
  }

  protected updateSeason(ev: Event): void {
    const t = ev.target;
    if (t instanceof HTMLInputElement) {
      const n = parseInt(t.value, 10);
      this.markSeason.set(Number.isFinite(n) ? n : 1);
      // If the previously chosen episode is past the new season's count, clamp.
      const max = this.markEpisodeMax();
      if (this.markEpisode() > max) this.markEpisode.set(max);
    }
  }

  protected updateEpisode(ev: Event): void {
    const t = ev.target;
    if (t instanceof HTMLInputElement) {
      const n = parseInt(t.value, 10);
      this.markEpisode.set(Number.isFinite(n) ? n : 1);
    }
  }

  protected async submitMark(ev: Event): Promise<void> {
    ev.preventDefault();
    const item = this.markItem();
    if (!item) return;
    const season = this.markSeason();
    const episode = this.markEpisode();
    if (season < 1 || episode < 1) {
      this.markError.set('Stagione ed episodio devono essere >= 1');
      return;
    }

    this.markSubmitting.set(true);
    this.markError.set('');
    try {
      const ok = await this.watchlist.markWatchedThrough(item.tmdb_id, item.media_type, season, episode);
      if (!ok) {
        this.markError.set('Stagione o episodio non validi per questa serie');
        return;
      }
      this.toast.show(`Progresso aggiornato a S${season}E${episode}`);
      this.markOpen.set(false);
      // Reload to refresh badges
      void this.load(this.kind());
    } finally {
      this.markSubmitting.set(false);
    }
  }

  protected async markAll(): Promise<void> {
    const item = this.markItem();
    if (!item) return;
    this.markSubmitting.set(true);
    this.markError.set('');
    try {
      const ok = await this.watchlist.markWatchedAll(item.tmdb_id, item.media_type);
      if (!ok) {
        this.markError.set('Impossibile marcare come visto (TMDB non disponibile?)');
        return;
      }
      this.toast.show(`${item.title}: segnato come visto`);
      this.markOpen.set(false);
      // Reload to refresh badges and (likely) move the item to the "Visto" filter
      void this.load(this.kind());
    } finally {
      this.markSubmitting.set(false);
    }
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
        watchStatus: computeWatchStatus(w),
        totalSeasons: w.total_seasons,
        lastSeason: w.last_season,
        lastEpisode: w.last_episode,
        seasons: w.seasons,
        season: w.next_season,
        episode: w.next_episode,
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
