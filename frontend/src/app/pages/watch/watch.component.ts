import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, numberAttribute, signal } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { faThumbsUp } from '@fortawesome/free-solid-svg-icons';
import { IconComponent } from '../../components/icon/icon.component';
import { SectionRowComponent } from '../../components/section-row/section-row.component';
import { PlayerService } from '../../services/player.service';
import { TmdbService } from '../../services/tmdb.service';
import { NavigationSourceService } from '../../services/navigation-source.service';
import { BackgroundService } from '../../services/background.service';
import type { CardItem, MediaType, TmdbItem } from '../../models';

@Component({
  selector: 'app-watch',
  standalone: true,
  imports: [IconComponent, SectionRowComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="watch-page">
      <div class="watch-main">
        <div class="watch-back">
          <button class="back-btn" (click)="back()">
            <app-icon name="chevron-left"></app-icon>
            <span>Indietro</span>
          </button>
        </div>
        <div class="watch-header">
          @if (loading()) {
            <div class="skeleton skeleton-title"></div>
          } @else {
            <h2>{{ title() }}</h2>
          }
        </div>

        <div class="player-container">
        @if (loading() && player.currentItemType() !== 'movie') {
          <div class="episode-controls active">
            <div class="skeleton skeleton-select"></div>
            <div class="skeleton skeleton-select"></div>
          </div>
        } @else if (player.currentItemType() === 'tv' && player.seasons().length > 0) {
          <div class="episode-controls active">
            <select (change)="onSeasonChange($event)">
              @for (s of player.seasons(); track s) {
                <option [value]="s" [selected]="s === player.selectedSeason()">Stagione {{ s }}</option>
              }
            </select>
            <select (change)="onEpisodeChange($event)">
              @for (e of player.episodes(); track e) {
                <option [value]="e" [selected]="e === player.selectedEpisode()">Episodio {{ e }}</option>
              }
            </select>
          </div>
        }

        @if (loading() || player.iframeSrc()) {
          <div class="player-wrapper">
            @if (loading()) {
              <div class="skeleton skeleton-backdrop"></div>
            } @else {
              <iframe [src]="iframeSrcSafe()" allowfullscreen
                      allow="autoplay; encrypted-media; fullscreen"></iframe>
            }
          </div>
        }

        @if (loading()) {
          <div class="player-actions">
            <div class="skeleton skeleton-btn"></div>
            <div class="skeleton skeleton-btn-icon"></div>
          </div>
        } @else if (!player.iframeSrc()) {
          <div class="player-actions">
            <button class="action-btn primary" (click)="play()">
              <app-icon name="play"></app-icon>
              <span>{{ playLabel() }}</span>
            </button>
            @if (showNextButton()) {
              <button class="action-btn" (click)="playNext()">
                <span>Vai al prossimo</span>
              </button>
            }
            <button class="action-btn icon-only" [class.active]="player.isInWatchlist()"
                    [attr.aria-label]="player.isInWatchlist() ? 'Rimuovi dalla lista' : 'Aggiungi alla lista'"
                    [title]="player.isInWatchlist() ? 'Rimuovi dalla lista' : 'Aggiungi alla lista'"
                    (click)="toggleWatchlist()">
              <app-icon name="bookmark"></app-icon>
            </button>
          </div>
        }

        <div class="player-info">
          @if (loading()) {
            <div class="skeleton skeleton-line short"></div>
            <div class="skeleton skeleton-line"></div>
            <div class="skeleton skeleton-line"></div>
            <div class="skeleton skeleton-line medium"></div>
          } @else {
            @if (taglineStr()) {
              <p class="player-tagline">{{ taglineStr() }}</p>
            }
            @if (metaStr()) {
              <p class="player-meta">{{ metaStr() }}</p>
            }
            @if (genresStr()) {
              <p class="player-genres">{{ genresStr() }}</p>
            }
            <p>{{ overview() }}</p>
            @if (castStr()) {
              <p class="player-cast"><strong>Cast:</strong> {{ castStr() }}</p>
            }
            @if (tvSummaryStr()) {
              <p class="player-extra">{{ tvSummaryStr() }}</p>
            }
          }
        </div>
      </div>
      </div>

      @if (recommendations().length > 0 || recommendationsLoading()) {
        <app-section-row
          class="watch-recommendations"
          title="Ti potrebbe piacere"
          [icon]="recommendationsIcon"
          [items]="recommendations()"
          [loading]="recommendationsLoading()"
          (cardClick)="openRecommendation($event)" />
      }
    </div>
  `,
  styleUrl: './watch.component.css'
})
export class WatchComponent {
  protected readonly player = inject(PlayerService);
  private readonly tmdb = inject(TmdbService);
  private readonly router = inject(Router);
  private readonly navSource = inject(NavigationSourceService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly destroyRef = inject(DestroyRef);
  private readonly background = inject(BackgroundService);

  protected readonly recommendationsIcon = faThumbsUp;
  protected readonly recommendations = signal<CardItem[]>([]);
  protected readonly recommendationsLoading = signal(false);

  // Sequence guards out-of-order recommendation responses when the user
  // jumps between titles before the previous fetch resolves.
  private recommendationsSeq = 0;

  // Bound from route params/query via withComponentInputBinding().
  readonly type = input.required<MediaType>();
  readonly id = input.required<string>();
  readonly s = input(0, { transform: numberAttribute });
  readonly e = input(0, { transform: numberAttribute });

  // True while the watch page is fetching TMDB details for this title — no
  // currentItem yet means dropdowns/title/info would render empty, which
  // looks broken. Skeletons fill that gap.
  protected readonly loading = computed(() => this.player.currentItem() === null);

  protected readonly title = computed(() => {
    const it = this.player.currentItem();
    return it?.title ?? it?.name ?? '';
  });

  protected readonly overview = computed(() => this.player.currentItem()?.overview ?? 'Descrizione non disponibile.');

  // Strings (not arrays) so signal equality dedupes spurious updates.
  protected readonly taglineStr = computed(() => this.player.currentItem()?.tagline ?? '');

  protected readonly metaStr = computed(() => {
    const it = this.player.currentItem();
    if (!it) return '';
    const parts: string[] = [];
    const date = it.release_date ?? it.first_air_date ?? '';
    const year = date.split('-')[0];
    if (year) parts.push(year);
    const rt = formatRuntime(it, this.player.currentItemType());
    if (rt) parts.push(rt);
    if (it.vote_average) {
      parts.push(`★ ${it.vote_average.toFixed(1)}`);
    }
    return parts.join(' · ');
  });

  protected readonly genresStr = computed(() => {
    const gs = this.player.currentItem()?.genres ?? [];
    return gs.map(g => g.name).join(', ');
  });

  protected readonly castStr = computed(() => {
    const c = this.player.currentItem()?.credits?.cast ?? [];
    return c.slice(0, 6).map(m => m.name).join(', ');
  });

  // 80% mirrors WATCHED_THRESHOLD on the backend — past that point we
  // assume the user is "done enough" with this episode that they'd plausibly
  // want to skip straight to the next one.
  protected readonly showNextButton = computed(() => {
    if (!this.player.nextEpisode()) return false;
    const p = this.player.resumeProgress();
    if (!p || p.duration <= 0) return false;
    return p.position / p.duration >= 0.8;
  });

  protected readonly playLabel = computed(() => {
    const p = this.player.resumeProgress();
    if (p && p.position > 10) return `Riprendi da ${formatTime(p.position)}`;
    return 'Guarda';
  });

  protected readonly tvSummaryStr = computed(() => {
    if (this.player.currentItemType() !== 'tv') return '';
    const it = this.player.currentItem();
    const seasons = it?.number_of_seasons ?? 0;
    const episodes = it?.number_of_episodes ?? 0;
    if (!seasons) return '';
    const ses = seasons === 1 ? 'stagione' : 'stagioni';
    const eps = episodes === 1 ? 'episodio' : 'episodi';
    if (!episodes) return `${seasons} ${ses}`;

    // Compute how many episodes have already aired by walking the seasons
    // list up to last_episode_to_air. If TMDB doesn't expose either field
    // we just fall back to the total count.
    const last = it?.last_episode_to_air;
    let aired = 0;
    if (last && it?.seasons?.length) {
      for (const s of it.seasons) {
        if (s.season_number === 0) continue;
        if (last.season_number === undefined) continue;
        if (s.season_number < last.season_number) {
          aired += s.episode_count ?? 0;
        } else if (s.season_number === last.season_number) {
          aired += last.episode_number ?? 0;
        }
      }
    }

    if (aired > 0 && aired < episodes) {
      return `${seasons} ${ses} · ${aired}/${episodes} ${eps} usciti`;
    }
    return `${seasons} ${ses} · ${episodes} ${eps}`;
  });

  // Same-origin URL but Angular still sanitizes iframe src by default.
  // Mark as trusted resource since the URL comes entirely from our own service.
  protected readonly iframeSrcSafe = computed<SafeResourceUrl>(
    () => this.sanitizer.bypassSecurityTrustResourceUrl(this.player.iframeSrc())
  );

  constructor() {
    effect(() => {
      const id = this.id();
      const type = this.type();
      if (!id || (type !== 'movie' && type !== 'tv')) return;
      void this.player.open(id, type, this.s(), this.e());
    });

    // Mirror the player's backdrop into the global app background while
    // the watch page is mounted. Cleared on destroy so other pages don't
    // inherit this title's artwork.
    effect(() => {
      this.background.setUrl(this.player.backdropUrl() || null);
    });

    // Recommendations are tied to the *route inputs* (not the loaded item)
    // so they kick off the moment the URL changes, in parallel with the
    // TMDB details fetch. Skips empty/invalid combos.
    effect(() => {
      const id = this.id();
      const type = this.type();
      if (!id || (type !== 'movie' && type !== 'tv')) {
        this.recommendations.set([]);
        return;
      }
      void this.loadRecommendations(id, type);
    });

    this.destroyRef.onDestroy(() => {
      this.player.cleanup();
      this.background.clear();
    });
  }

  private async loadRecommendations(id: string, type: MediaType): Promise<void> {
    const seq = ++this.recommendationsSeq;
    this.recommendationsLoading.set(true);
    this.recommendations.set([]);
    const results = await this.tmdb.getRecommendations(id, type);
    if (seq !== this.recommendationsSeq) return;
    this.recommendations.set(results.slice(0, 20).map(it => tmdbToCard(it, type)));
    this.recommendationsLoading.set(false);
  }

  protected openRecommendation(item: CardItem): void {
    // Normal push (no replaceUrl) so the navigation stack tracks each
    // recommendation the user opens. "Indietro" then walks back through
    // them one by one — same as the browser's native back button.
    void this.router.navigate(['/watch', item.media_type, item.tmdb_id]);
  }

  protected back(): void {
    this.navSource.goBack('/browse');
  }

  protected play(): void {
    this.player.startVideo();
  }

  protected playNext(): void {
    void this.player.playNextEpisode();
  }

  protected toggleWatchlist(): void {
    void this.player.toggleWatchlist();
  }

  protected onSeasonChange(ev: Event): void {
    const t = ev.target;
    if (t instanceof HTMLSelectElement) void this.player.changeSeason(parseInt(t.value, 10));
  }

  protected onEpisodeChange(ev: Event): void {
    const t = ev.target;
    if (t instanceof HTMLSelectElement) void this.player.changeEpisode(parseInt(t.value, 10));
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

function formatTime(seconds: number): string {
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function formatRuntime(item: { runtime?: number; episode_run_time?: number[] }, type: MediaType | null): string {
  if (type === 'movie') {
    const r = item.runtime;
    if (!r) return '';
    const h = Math.floor(r / 60);
    const m = r % 60;
    if (h && m) return `${h}h ${m}min`;
    if (h) return `${h}h`;
    return `${m}min`;
  }
  if (type === 'tv') {
    const arr = item.episode_run_time ?? [];
    const first = arr[0];
    return first ? `${first} min/episodio` : '';
  }
  return '';
}
