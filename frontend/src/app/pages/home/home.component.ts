import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { faCirclePlay, faBookmark } from '@fortawesome/free-solid-svg-icons';
import { SectionRowComponent } from '../../components/section-row/section-row.component';
import { TmdbService } from '../../services/tmdb.service';
import { ProgressService } from '../../services/progress.service';
import { WatchlistService } from '../../services/watchlist.service';
import { AuthService } from '../../services/auth.service';
import { PlayerService } from '../../services/player.service';
import { SECTIONS } from './sections.config';
import { computeWatchStatus } from '../../services/watchlist-status.util';
import type { MediaType, TmdbItem, CardItem, SectionConfig } from '../../models';

interface SectionState {
  config: SectionConfig;
  items: CardItem[];
}

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [SectionRowComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (auth.isLoggedIn() && continueItems().length > 0) {
      <app-section-row
        title="Continua a guardare"
        [icon]="continueIcon"
        [items]="continueItems()"
        [showProgress]="true"
        (cardClick)="open($event)" />
    }

    @if (auth.isLoggedIn() && watchlistItems().length > 0) {
      <app-section-row
        title="La mia lista"
        [icon]="watchlistIcon"
        [items]="watchlistItems()"
        [showProgress]="true"
        (cardClick)="open($event)" />
    }

    @for (s of sectionStates(); track s.config.id) {
      <app-section-row
        [title]="s.config.title"
        [icon]="s.config.icon"
        [items]="s.items"
        (cardClick)="open($event)" />
    }
  `
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

  protected readonly continueIcon = faCirclePlay;
  protected readonly watchlistIcon = faBookmark;

  protected readonly continueItems = signal<CardItem[]>([]);
  protected readonly watchlistItems = signal<CardItem[]>([]);
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

  private async loadTmdbSections(type: MediaType): Promise<void> {
    const seq = ++this.tmdbSeq;
    const configs = SECTIONS[type];
    // Show empty placeholders immediately so the layout is stable
    this.sectionStates.set(configs.map(c => ({ config: c, items: [] })));

    const results = await Promise.all(configs.map(c => this.tmdb.list(c.endpoint)));
    if (seq !== this.tmdbSeq) return; // a newer load started, drop stale results
    this.sectionStates.set(configs.map((c, i) => ({
      config: c,
      items: (results[i] ?? []).slice(0, 20).map(it => tmdbToCard(it, type))
    })));
  }

  private async loadUserSections(): Promise<void> {
    const seq = ++this.userSeq;
    if (!this.auth.isLoggedIn()) {
      this.continueItems.set([]);
      this.watchlistItems.set([]);
      return;
    }
    const [progress, wl] = await Promise.all([this.progress.list(), this.watchlist.list()]);
    if (seq !== this.userSeq) return;
    this.continueItems.set(progress.map(p => ({
      tmdb_id: p.tmdb_id, media_type: p.media_type, title: p.title ?? 'Senza titolo',
      poster: p.poster, season: p.season, episode: p.episode, position: p.position, duration: p.duration
    })));
    // Hide items marked "Visto" — the home row is for things still to watch.
    // Carry the same enrichment the watchlist page uses so the cards show the
    // progress bar + "Mancano N episodi" badge. We deliberately omit
    // season/episode so the card click triggers auto-resume on the watch page.
    this.watchlistItems.set(wl.filter(w => (w.status ?? 'todo') !== 'done').map(w => ({
      tmdb_id: w.tmdb_id,
      media_type: w.media_type,
      title: w.title ?? 'Senza titolo',
      poster: w.poster,
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
