import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { faCirclePlay, faBookmark } from '@fortawesome/free-solid-svg-icons';
import { SectionRowComponent } from '../../components/section-row/section-row.component';
import { TmdbService } from '../../services/tmdb.service';
import { ProgressService } from '../../services/progress.service';
import { WatchlistService } from '../../services/watchlist.service';
import { AuthService } from '../../services/auth.service';
import { PlayerService } from '../../services/player.service';
import { ToastService } from '../../services/toast.service';
import { getCompactReleaseStatusText } from '../../utils/media-release.util';
import { SECTIONS } from './sections.config';
import type { MediaType, TmdbItem, CardItem, SectionConfig } from '../../models';

interface SectionState {
  config: SectionConfig;
  items: CardItem[];
  loading: boolean;
}

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [SectionRowComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (auth.isLoggedIn() && (continueItems().length > 0 || userLoading())) {
      <app-section-row
        title="Continua a guardare"
        [icon]="continueIcon"
        [items]="continueItems()"
        [loading]="userLoading()"
        [showProgress]="true"
        [showRemove]="true"
        (cardClick)="open($event)"
        (removeClick)="removeContinue($event)" />
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
  `
})
export class HomeComponent {
  private readonly tmdb = inject(TmdbService);
  private readonly progress = inject(ProgressService);
  private readonly watchlist = inject(WatchlistService);
  protected readonly auth = inject(AuthService);
  private readonly player = inject(PlayerService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  protected readonly continueIcon = faCirclePlay;
  protected readonly watchlistIcon = faBookmark;

  protected readonly continueItems = signal<CardItem[]>([]);
  protected readonly watchlistItems = signal<CardItem[]>([]);
  protected readonly userLoading = signal(false);
  protected readonly sectionStates = signal<SectionState[]>([]);

  private userSeq = 0;

  constructor() {
    void this.loadTmdbSections();

    effect(() => {
      this.auth.currentUser();
      this.player.progressTick();
      this.progress.tick();
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

  protected async removeContinue(item: CardItem): Promise<void> {
    await this.progress.hideTitle(item.tmdb_id, item.media_type);
    this.continueItems.update((items) =>
      items.filter((candidate) => !(candidate.tmdb_id === item.tmdb_id && candidate.media_type === item.media_type))
    );
    this.toast.show(`${item.title}: nascosto da continua a guardare`);
  }

  private async loadTmdbSections(): Promise<void> {
    this.sectionStates.set(SECTIONS.map(c => ({ config: c, items: [], loading: true })));

    const results = await Promise.all(SECTIONS.map(c => this.tmdb.list(c.endpoint)));
    this.sectionStates.set(SECTIONS.map((c, i) => ({
      config: c,
      items: (results[i] ?? []).slice(0, 20).map(it => tmdbToCard(it, c.mediaType)),
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

    const progressCards = await enrichCardsWithTmdb(progress.map(p => ({
      tmdb_id: p.tmdb_id,
      media_type: p.media_type,
      title: p.title ?? 'Senza titolo',
      poster: p.poster,
      season: p.season,
      episode: p.episode,
      position: p.position,
      duration: p.duration
    })), this.tmdb);
    if (seq !== this.userSeq) return;

    const watchlistCards = await enrichCardsWithTmdb(wl.filter(w => (w.status ?? 'todo') !== 'done').map(w => ({
      tmdb_id: w.tmdb_id,
      media_type: w.media_type,
      title: w.title ?? 'Senza titolo',
      poster: w.poster,
      season: w.resume_season,
      episode: w.resume_episode,
      position: w.position,
      duration: w.duration,
      watchStatus: w.watch_status_text
    })), this.tmdb);
    if (seq !== this.userSeq) return;

    this.userLoading.set(false);
    this.continueItems.set(progressCards);
    this.watchlistItems.set(watchlistCards);
  }
}

function tmdbToCard(item: TmdbItem, type: MediaType): CardItem {
  const dateStr = item.release_date ?? item.first_air_date ?? '';
  return {
    tmdb_id: item.id,
    media_type: type,
    title: item.title ?? item.name ?? 'Senza titolo',
    poster: item.poster_path ?? null,
    popularity: item.popularity,
    voteCount: item.vote_count,
    year: dateStr.split('-')[0] ?? '',
    rating: item.vote_average ? item.vote_average.toFixed(1) : ''
  };
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
      year: item.year ?? (details.release_date ?? details.first_air_date ?? '').split('-')[0] ?? '',
      nextReleaseText: getCompactReleaseStatusText(details, item.media_type)
    };
  }));
}
