import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, numberAttribute, signal } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { faCommentDots, faThumbsUp } from '@fortawesome/free-solid-svg-icons';
import { IconComponent } from '../../ui/icon/icon.component';
import { MediaRankBadgeComponent } from '../../ui/media-rank-badge/media-rank-badge.component';
import { SectionHeaderComponent } from '../../ui/section-header/section-header.component';
import { SectionRowComponent } from '../../components/section-row/section-row.component';
import { PlayerService } from '../../services/player.service';
import { TmdbService } from '../../services/tmdb.service';
import { NavigationSourceService } from '../../services/navigation-source.service';
import { BackgroundService } from '../../services/background.service';
import { tmdbToCardItem } from '../../utils/card-item.util';
import { getFullReleaseStatusText, isTitleUpcoming } from '../../utils/media-release.util';
import type { CardItem, MediaType, TmdbReview } from '../../models';

@Component({
  selector: 'app-watch',
  standalone: true,
  imports: [IconComponent, MediaRankBadgeComponent, SectionHeaderComponent, SectionRowComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="watch-page">
      <div class="watch-main">
        <div class="watch-top-row">
          <button class="back-btn" (click)="back()">
            <app-icon name="chevron-left"></app-icon>
            <span>Indietro</span>
          </button>
          @if (!loading()) {
            <app-media-rank-badge
              class="watch-rank-badge"
              align="right"
              [popularity]="player.currentItem()?.popularity ?? null"
              [voteCount]="player.currentItem()?.vote_count ?? null" />
          }
        </div>
        <div class="watch-header">
          @if (loading()) {
            <div class="skeleton skeleton-title"></div>
          } @else {
            <div class="watch-heading">
              <h2>{{ title() }}</h2>
            </div>
          }
        </div>

        <div class="player-container">
        @if (loading() && player.currentItemType() !== 'movie') {
          <div class="episode-controls active">
            <div class="select-group">
              <div class="skeleton skeleton-label"></div>
              <div class="skeleton skeleton-select"></div>
            </div>
          </div>
        } @else if (!isUpcomingTitle() && player.currentItemType() === 'tv' && player.seasons().length > 0) {
          <div class="episode-controls active">
            <label class="select-group">
              <span class="select-label">Stagione</span>
              <select (change)="onSeasonChange($event)">
                @for (s of player.seasons(); track s) {
                  <option [value]="s" [selected]="s === player.selectedSeason()">Stagione {{ s }}</option>
                }
              </select>
            </label>
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
        } @else if (isUpcomingTitle()) {
          <div class="player-actions">
            <div class="release-inline-note">{{ upcomingAvailabilityStr() }}</div>
            <button class="action-btn icon-only" [class.active]="player.isInWatchlist()"
                    [attr.aria-label]="player.isInWatchlist() ? 'Rimuovi dalla lista' : 'Aggiungi alla lista'"
                    [title]="player.isInWatchlist() ? 'Rimuovi dalla lista' : 'Aggiungi alla lista'"
                    (click)="toggleWatchlist()">
              <app-icon name="bookmark"></app-icon>
            </button>
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
        } @else {
          <div class="player-actions">
            <button class="action-btn" (click)="closePlayer()">
              <app-icon name="close"></app-icon>
              <span>Chiudi player</span>
            </button>
            <button class="action-btn icon-only" [class.active]="player.isInWatchlist()"
                    [attr.aria-label]="player.isInWatchlist() ? 'Rimuovi dalla lista' : 'Aggiungi alla lista'"
                    [title]="player.isInWatchlist() ? 'Rimuovi dalla lista' : 'Aggiungi alla lista'"
                    (click)="toggleWatchlist()">
              <app-icon name="bookmark"></app-icon>
            </button>
          </div>
        }

        @if (loading() && type() === 'tv') {
          <div class="episode-grid-section">
            <div class="skeleton skeleton-section-title"></div>
            <div class="episode-grid">
              @for (i of skeletonRange; track i) {
                <div class="episode-card skeleton-card">
                  <div class="skeleton skeleton-card-thumb"></div>
                  <div class="skeleton skeleton-line short"></div>
                  <div class="skeleton skeleton-line"></div>
                </div>
              }
            </div>
          </div>
        } @else if (!isUpcomingTitle() && player.currentItemType() === 'tv' && player.episodes().length > 0) {
          <div class="episode-grid-section">
            <h3 class="episode-grid-title">Episodi</h3>
            <div class="episode-grid">
              @for (ep of player.episodes(); track ep.episode_number) {
                <button type="button" class="episode-card"
                        [class.selected]="ep.episode_number === activeInThisSeason()"
                        (click)="selectEpisode(ep.episode_number)">
                  <div class="episode-thumb"
                       [class.no-image]="!ep.still_path"
                       [style.background-image]="ep.still_path ? 'url(' + episodeThumbBase + ep.still_path + ')' : null">
                    <span class="episode-number">{{ ep.episode_number }}</span>
                    @if (episodeProgressLabel(ep)) {
                      <span class="episode-duration">{{ episodeProgressLabel(ep) }}</span>
                    }
                    @if (episodeProgress(ep.episode_number) > 0) {
                      <div class="episode-progress"><span [style.width.%]="episodeProgress(ep.episode_number)"></span></div>
                    }
                  </div>
                  <div class="episode-meta">
                    <p class="episode-title">{{ ep.name || 'Episodio ' + ep.episode_number }}</p>
                    @if (ep.overview) {
                      <p class="episode-overview">{{ ep.overview }}</p>
                    }
                  </div>
                </button>
              }
            </div>
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
            @if (releaseStatusStr()) {
              <p class="player-release-status">{{ releaseStatusStr() }}</p>
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

      @if (reviews().length > 0 || reviewsLoading()) {
        <section class="watch-reviews content-section">
          <app-section-header title="Recensioni" [icon]="reviewsIcon" />

          @if (reviewsLoading()) {
            <div class="reviews-row">
              @for (i of skeletonRange; track i) {
                <article class="review-card skeleton-review-card">
                  <div class="skeleton skeleton-review-head"></div>
                  <div class="skeleton skeleton-review-line"></div>
                  <div class="skeleton skeleton-review-line"></div>
                  <div class="skeleton skeleton-review-line short"></div>
                </article>
              }
            </div>
          } @else {
            <div class="reviews-row">
              @for (review of reviews(); track review.id) {
                <article class="review-card">
                  <div class="review-head">
                    <div class="review-author-block">
                      <h3 class="review-author">{{ reviewAuthor(review) }}</h3>
                      @if (reviewDate(review)) {
                        <p class="review-date">{{ reviewDate(review) }}</p>
                      }
                    </div>
                    @if (reviewRating(review)) {
                      <span class="review-rating">★ {{ reviewRating(review) }}</span>
                    }
                  </div>

                  <p class="review-content">{{ reviewExcerpt(review) }}</p>

                  @if (review.url) {
                    <a class="review-link"
                       [href]="review.url"
                       target="_blank"
                       rel="noopener noreferrer"
                       (click)="openReview($event, review.url)">
                      Leggi su TMDB
                    </a>
                  }
                </article>
              }
            </div>
          }
        </section>
      }

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
  protected readonly reviewsIcon = faCommentDots;
  protected readonly recommendations = signal<CardItem[]>([]);
  protected readonly recommendationsLoading = signal(false);
  protected readonly reviews = signal<TmdbReview[]>([]);
  protected readonly reviewsLoading = signal(false);

  // TMDB still-image base. w300 is 300×169 — enough for crisp thumbnails on
  // 220px-wide cards even on retina, without the bandwidth cost of w500/w780.
  protected readonly episodeThumbBase = 'https://image.tmdb.org/t/p/w300';

  // Static array used by the skeleton loop — doesn't need to be a signal
  // since it never changes. Five placeholder cards is enough to fill a
  // typical viewport before the user scrolls.
  protected readonly skeletonRange = [0, 1, 2, 3, 4];

  // Sequence guards out-of-order recommendation responses when the user
  // jumps between titles before the previous fetch resolves.
  private recommendationsSeq = 0;
  private reviewsSeq = 0;

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

  protected readonly releaseStatusStr = computed(() => {
    const item = this.player.currentItem();
    const type = this.player.currentItemType();
    if (!item || !type) return '';
    return getFullReleaseStatusText(item, type);
  });

  protected readonly isUpcomingTitle = computed(() => {
    const item = this.player.currentItem();
    const type = this.player.currentItemType();
    return item !== null && type !== null ? isTitleUpcoming(item, type) : false;
  });

  protected readonly upcomingAvailabilityStr = computed(() => {
    const status = this.releaseStatusStr().trim().replace(/\.$/, '');
    return status ? `Disponibile: ${status}` : 'Disponibile dopo l\'uscita';
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

  // Episode number to highlight on the card grid for the season currently
  // shown in the dropdown. Resolution order:
  //   1. The actively-loaded episode if it belongs to this season — covers
  //      "I just clicked S1E3, S1E3 should be the highlight".
  //   2. Otherwise the next-unwatched episode if it belongs to this season
  //      — covers "I'm browsing S5 to see where I was; mark S5E7 even
  //      though I'm currently rewatching S1E3 in another season".
  //   3. Otherwise no highlight (the user is browsing a season unrelated
  //      to either marker).
  protected readonly activeInThisSeason = computed<number | null>(() => {
    const season = this.player.selectedSeason();
    const active = this.player.activeEpisodeRef();
    if (active && active.season === season) return active.episode;
    const next = this.player.nextUnwatchedRef();
    if (next && next.season === season) return next.episode;
    return null;
  });

  protected readonly playLabel = computed(() => {
    // TV: the CTA is anchored to the *next-unwatched* episode for this
    // user, not the currently-selected card. Lets the user explore older
    // episodes via the grid without losing their "continue here" entry.
    if (this.player.currentItemType() === 'tv') {
      const ref = this.player.nextUnwatchedRef();
      if (!ref) return 'Guarda';
      return `Riprendi da S${ref.season} E${ref.episode}`;
    }
    // Movies still use a timestamp — there's no episode coordinate to
    // fall back on, and "Riprendi da 12:34" is the universal convention.
    const p = this.player.resumeProgress();
    if (!p || p.position <= 10) return 'Guarda';
    return `Riprendi da ${formatTime(p.position)}`;
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

    effect(() => {
      const id = this.id();
      const type = this.type();
      if (!id || (type !== 'movie' && type !== 'tv')) {
        this.reviews.set([]);
        return;
      }
      void this.loadReviews(id, type);
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
    this.recommendations.set(results.slice(0, 20).map(it => tmdbToCardItem(it, type, { releaseTextMode: 'upcoming-only' })));
    this.recommendationsLoading.set(false);
  }

  private async loadReviews(id: string, type: MediaType): Promise<void> {
    const seq = ++this.reviewsSeq;
    this.reviewsLoading.set(true);
    this.reviews.set([]);
    const results = await this.tmdb.getReviews(id, type);
    if (seq !== this.reviewsSeq) return;
    this.reviews.set(results.slice(0, 10));
    this.reviewsLoading.set(false);
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
    void this.player.playPrimary();
  }

  protected playNext(): void {
    void this.player.playNextEpisode();
  }

  protected closePlayer(): void {
    void this.player.stopPlayback();
  }

  protected toggleWatchlist(): void {
    void this.player.toggleWatchlist();
  }

  protected reviewAuthor(review: TmdbReview): string {
    return review.author_details?.name || review.author_details?.username || review.author || 'Anonimo';
  }

  protected reviewRating(review: TmdbReview): string {
    const rating = review.author_details?.rating;
    return typeof rating === 'number' ? rating.toFixed(1) : '';
  }

  protected reviewDate(review: TmdbReview): string {
    const raw = review.updated_at || review.created_at;
    if (!raw) return '';
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('it-IT', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    }).format(date);
  }

  protected reviewExcerpt(review: TmdbReview): string {
    const text = review.content.trim();
    if (text.length <= 360) return text;
    return `${text.slice(0, 357).trimEnd()}...`;
  }

  protected openReview(event: Event, url?: string): void {
    if (!url) return;
    event.preventDefault();
    event.stopPropagation();

    const opened = window.open(url, '_blank', 'noopener,noreferrer');
    if (!opened) {
      window.location.assign(url);
    }
  }

  protected onSeasonChange(ev: Event): void {
    const t = ev.target;
    if (t instanceof HTMLSelectElement) void this.player.changeSeason(parseInt(t.value, 10));
  }

  protected selectEpisode(episodeNumber: number): void {
    // Card click is a "play" action, not a "select" action — clicking a
    // card and then having to find the CTA again would be a wasted tap.
    // playEpisodeFromCard switches the player and starts the episode in
    // a single call. The CTA stays anchored to next-unwatched.
    void this.player.playEpisodeFromCard(episodeNumber);
  }

  // Progress percentage (0–100) for the given episode card in the
  // currently-selected season. Returns 0 when there's no progress, which
  // the template uses to skip rendering the bar entirely.
  protected episodeProgress(episodeNumber: number): number {
    const map = this.player.seriesProgress();
    const key = `s${this.player.selectedSeason()}e${episodeNumber}`;
    const p = map.get(key);
    if (!p || p.duration <= 0) return 0;
    return Math.min(100, Math.max(0, (p.position / p.duration) * 100));
  }

  protected episodeProgressLabel(ep: { episode_number: number; runtime?: number | null }): string {
    const map = this.player.seriesProgress();
    const key = `s${this.player.selectedSeason()}e${ep.episode_number}`;
    const progress = map.get(key);
    const totalSeconds = progress?.duration && progress.duration > 0
      ? progress.duration
      : (ep.runtime && ep.runtime > 0 ? ep.runtime * 60 : 0);
    if (totalSeconds <= 0) return '';
    const watchedSeconds = progress?.position && progress.position > 0 ? progress.position : 0;
    return `${formatTimeCompact(watchedSeconds)}/${formatTimeCompact(totalSeconds)}`;
  }
}

function formatTime(seconds: number): string {
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function formatTimeCompact(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
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
