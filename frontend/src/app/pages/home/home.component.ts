import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { faCirclePlay, faBookmark } from '@fortawesome/free-solid-svg-icons';
import { SectionRowComponent } from '../../components/section-row/section-row.component';
import { UiTabsComponent, UiTab } from '../../ui/tabs/tabs.component';
import { TmdbService } from '../../services/tmdb.service';
import { ProgressService } from '../../services/progress.service';
import { WatchlistService } from '../../services/watchlist.service';
import { AuthService } from '../../services/auth.service';
import { PlayerService } from '../../services/player.service';
import { SECTIONS } from './sections.config';
import { computeWatchStatus } from '../../services/watchlist-status.util';
import type { MediaType, TmdbItem, CardItem, SectionConfig } from '../../models';

const TYPE_TABS: ReadonlyArray<UiTab<MediaType>> = [
  { value: 'movie', label: 'Film' },
  { value: 'tv', label: 'Serie TV' }
];

interface SectionState {
  config: SectionConfig;
  items: CardItem[];
  loading: boolean;
}

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [SectionRowComponent, UiTabsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="home-tabs">
      <ui-tabs [tabs]="typeTabs" [value]="type()" (valueChange)="onTypeChange($event)" />
    </div>

    @if (auth.isLoggedIn() && (continueItems().length > 0 || userLoading())) {
      <app-section-row
        title="Continua a guardare"
        [icon]="continueIcon"
        [items]="continueItems()"
        [loading]="userLoading()"
        [showProgress]="true"
        (cardClick)="open($event)" />
    }

    @if (auth.isLoggedIn() && (watchlistItems().length > 0 || userLoading())) {
      <app-section-row
        title="La mia lista"
        [icon]="watchlistIcon"
        [items]="watchlistItems()"
        [loading]="userLoading()"
        [showProgress]="true"
        (cardClick)="open($event)" />
    }

    @for (s of sectionStates(); track s.config.id) {
      <app-section-row
        [title]="s.config.title"
        [icon]="s.config.icon"
        [items]="s.items"
        [loading]="s.loading"
        (cardClick)="open($event)" />
    }
  `,
  styles: [`
    .home-tabs {
      display: flex;
      margin-bottom: 1.75rem;
    }

    @media (min-width: 769px) {
      .home-tabs { padding-left: 4rem; }
    }
  `]
})
export class HomeComponent {
  private readonly tmdb = inject(TmdbService);
  private readonly progress = inject(ProgressService);
  private readonly watchlist = inject(WatchlistService);
  protected readonly auth = inject(AuthService);
  private readonly player = inject(PlayerService);
  private readonly router = inject(Router);

  // Route :type param via withComponentInputBinding().
  readonly type = input.required<MediaType>();

  protected readonly typeTabs = TYPE_TABS;
  protected readonly continueIcon = faCirclePlay;
  protected readonly watchlistIcon = faBookmark;

  protected readonly continueItems = signal<CardItem[]>([]);
  protected readonly watchlistItems = signal<CardItem[]>([]);
  protected readonly userLoading = signal(false);
  protected readonly sectionStates = signal<SectionState[]>([]);

  // Sequence numbers — only the latest in-flight load is allowed to write state.
  private tmdbSeq = 0;
  private userSeq = 0;

  constructor() {
    // Reload TMDB sections on type change
    effect(() => {
      const type = this.type();
      void this.loadTmdbSections(type);
    });

    // Reload user sections on auth change, after a progress save (player closes/saves),
    // or when the watchlist is mutated from anywhere.
    effect(() => {
      this.auth.currentUser();
      this.player.progressTick();
      this.watchlist.tick();
      void this.loadUserSections();
    });
  }

  protected open(item: CardItem): void {
    const queryParams: Record<string, number> = {};
    if (item.season) queryParams['s'] = item.season;
    if (item.episode) queryParams['e'] = item.episode;
    void this.router.navigate(['/watch', item.media_type, item.tmdb_id], { queryParams });
  }

  protected onTypeChange(t: MediaType): void {
    if (t !== this.type()) void this.router.navigate(['/browse', t]);
  }

  private async loadTmdbSections(type: MediaType): Promise<void> {
    const seq = ++this.tmdbSeq;
    const configs = SECTIONS[type];
    // Show skeleton placeholders immediately so the layout is stable and the
    // user sees a clear "loading" state instead of empty rows that flash.
    this.sectionStates.set(configs.map(c => ({ config: c, items: [], loading: true })));

    const results = await Promise.all(configs.map(c => this.tmdb.list(c.endpoint)));
    if (seq !== this.tmdbSeq) return; // a newer load started, drop stale results
    this.sectionStates.set(configs.map((c, i) => ({
      config: c,
      items: (results[i] ?? []).slice(0, 20).map(it => tmdbToCard(it, type)),
      loading: false
    })));
  }

  private async loadUserSections(): Promise<void> {
    const seq = ++this.userSeq;
    if (!this.auth.isLoggedIn()) {
      this.continueItems.set([]);
      this.watchlistItems.set([]);
      this.userLoading.set(false);
      return;
    }
    this.userLoading.set(true);
    const [progress, wl] = await Promise.all([this.progress.list(), this.watchlist.list()]);
    if (seq !== this.userSeq) return;
    this.userLoading.set(false);
    this.continueItems.set(progress.map(p => ({
      tmdb_id: p.tmdb_id, media_type: p.media_type, title: p.title ?? 'Senza titolo',
      poster: p.poster, season: p.season, episode: p.episode, position: p.position, duration: p.duration
    })));
    // Hide items marked "Visto" — the home row is for things still to watch.
    // Carry the same enrichment the watchlist page uses so the cards show the
    // progress bar + "Mancano N episodi" badge. The backend resolves
    // `next_season` / `next_episode` (already pivoted past 'ended' eps), so
    // a click navigates straight to the right (s, e) without a follow-up
    // fetch on the watch page.
    this.watchlistItems.set(wl.filter(w => (w.status ?? 'todo') !== 'done').map(w => ({
      tmdb_id: w.tmdb_id,
      media_type: w.media_type,
      title: w.title ?? 'Senza titolo',
      poster: w.poster,
      season: w.next_season,
      episode: w.next_episode,
      position: w.position,
      duration: w.duration,
      watchStatus: computeWatchStatus(w)
    })));
  }
}

function tmdbToCard(item: TmdbItem, type: MediaType): CardItem {
  const dateStr = item.release_date ?? item.first_air_date ?? '';
  return {
    tmdb_id: item.id,
    media_type: type,
    title: item.title ?? item.name ?? 'Senza titolo',
    poster: item.poster_path ?? null,
    year: dateStr.split('-')[0] ?? '',
    rating: item.vote_average ? item.vote_average.toFixed(1) : ''
  };
}
