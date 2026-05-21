import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, numberAttribute, signal } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { faCommentDots, faThumbsUp } from '@fortawesome/free-solid-svg-icons';
import { ConfirmModalComponent } from '../../ui/confirm-modal/confirm-modal.component';
import { UiModalComponent } from '../../ui/modal/modal.component';
import { IconComponent } from '../../ui/icon/icon.component';
import { MediaRankBadgeComponent } from '../../ui/media-rank-badge/media-rank-badge.component';
import { PendingButtonDirective } from '../../ui/pending-button.directive';
import { SectionHeaderComponent } from '../../ui/section-header/section-header.component';
import { UiButtonDirective } from '../../ui/ui-button.directive';
import { UiSurfaceDirective } from '../../ui/ui-surface.directive';
import { UiSelectComponent, type UiSelectOption } from '../../ui/select/select.component';
import { SectionRowComponent } from '../../components/section-row/section-row.component';
import { PlayerService } from '../../services/player.service';
import { TmdbService } from '../../services/tmdb.service';
import { NavigationSourceService } from '../../services/navigation-source.service';
import { BackgroundService } from '../../services/background.service';
import { tmdbToCardItem } from '../../utils/card-item.util';
import { getFullReleaseStatusText, isTitleUpcoming } from '../../utils/media-release.util';
import { getAiredEpisodesCount } from '../../utils/aired-episodes.util';
import { runWithPending } from '../../utils/pending.util';
import { formatTime, formatRuntime, progressKey } from '../../utils/time.util';
import type { CardItem, MediaType, TmdbReview } from '../../models';

type ConfirmAction =
  | { type: 'remove-watchlist' }
  | { type: 'clear-progress'; season?: number; episode?: number }
  | { type: 'refresh-provider' };

@Component({
  selector: 'app-watch',
  standalone: true,
  imports: [IconComponent, ConfirmModalComponent, UiModalComponent, MediaRankBadgeComponent, PendingButtonDirective, SectionHeaderComponent, SectionRowComponent, UiButtonDirective, UiSurfaceDirective, UiSelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="watch-page">
      <div class="watch-main">
        <div class="watch-top-row">
          <button uiButton="back" type="button" (click)="back()">
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
        @if (loading() && type() === 'tv') {
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
              <ui-select
                [options]="seasonOptions()"
                [value]="player.selectedSeason()"
                (valueChange)="onSeasonChange($event)" />
            </label>
          </div>
        }

        @if (loading() || player.iframeSrc()) {
          <div class="player-wrapper">
            @if (loading()) {
              <div class="skeleton skeleton-backdrop"></div>
            } @else {
              <iframe [src]="iframeSrcSafe()" allowfullscreen
                      referrerpolicy="no-referrer"
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
            <button uiButton="icon" type="button"
                    uiButtonHover="accent"
                    [uiButtonTone]="player.isInWatchlist() ? 'accent' : 'default'"
                    [uiPending]="watchlistPending()"
                    [attr.aria-label]="player.isInWatchlist() ? 'Rimuovi dalla lista' : 'Aggiungi alla lista'"
                    [title]="player.isInWatchlist() ? 'Rimuovi dalla lista' : 'Aggiungi alla lista'"
                    (click)="toggleWatchlist()">
              <app-icon name="bookmark"></app-icon>
            </button>
          </div>
        } @else if (!player.iframeSrc()) {
          <div class="player-actions">
            <button uiButton="primary" type="button" [disabled]="!canStartPlayback()" (click)="play()">
              <app-icon name="play"></app-icon>
              <span>{{ primaryPlayLabel() }}</span>
            </button>
            @if (showManualProviderRefresh()) {
              <button uiButton type="button"
                      [uiPending]="providerRefreshPending()"
                      (click)="triggerManualProviderRefresh()">
                <app-icon name="rotate-left"></app-icon>
                <span>{{ manualProviderRefreshLabel() }}</span>
              </button>
            }
            @if (showProviderPicker()) {
              <button uiButton type="button" class="provider-picker-btn" (click)="openProviderPicker()">
                <app-icon name="search"></app-icon>
                <span>{{ providerPickerButtonLabel() }}</span>
              </button>
            }
            @if (showNextButton() && canStartPlayback()) {
              <button uiButton type="button" (click)="playNext()">
                <span>Vai al prossimo</span>
              </button>
            }
            <button uiButton="icon" type="button"
                    uiButtonHover="accent"
                    [uiButtonTone]="player.isInWatchlist() ? 'accent' : 'default'"
                    [uiPending]="watchlistPending()"
                    [attr.aria-label]="player.isInWatchlist() ? 'Rimuovi dalla lista' : 'Aggiungi alla lista'"
                    [title]="player.isInWatchlist() ? 'Rimuovi dalla lista' : 'Aggiungi alla lista'"
                    (click)="toggleWatchlist()">
              <app-icon name="bookmark"></app-icon>
            </button>
          </div>
          @if (showUnavailableHint()) {
            <p class="player-unavailable-hint">{{ unavailableHint() }}</p>
          }
        } @else {
          <div class="player-actions">
            <button uiButton type="button" (click)="closePlayer()">
              <app-icon name="close"></app-icon>
              <span>Chiudi player</span>
            </button>
            <button uiButton="icon" type="button"
                    uiButtonHover="accent"
                    [uiButtonTone]="player.isInWatchlist() ? 'accent' : 'default'"
                    [uiPending]="watchlistPending()"
                    [attr.aria-label]="player.isInWatchlist() ? 'Rimuovi dalla lista' : 'Aggiungi alla lista'"
                    [title]="player.isInWatchlist() ? 'Rimuovi dalla lista' : 'Aggiungi alla lista'"
                    (click)="toggleWatchlist()">
              <app-icon name="bookmark"></app-icon>
            </button>
          </div>
        }

        @if (!loading() && !isUpcomingTitle() && player.currentItemType() === 'movie' && movieProgressPct() !== null) {
          <div class="movie-progress-block">
            <div class="movie-progress-meta">
              <span>Progresso</span>
              <span>{{ movieProgressLabel() }}</span>
            </div>
            <div class="movie-progress-bar" aria-hidden="true">
              <span [style.width.%]="movieProgressPct()"></span>
            </div>
            <button uiButton="inline" type="button" [uiPending]="clearProgressPendingKey() === 'movie'" (click)="openClearProgressModal()">
              {{ clearProgressButtonLabel() }}
            </button>
          </div>
        }

        @if (loading() && type() === 'tv') {
          <div class="episode-grid-section">
            <div class="skeleton skeleton-section-title"></div>
            <div class="episode-grid ui-scroll-row ui-scroll-row-thin">
              @for (i of skeletonRange; track i) {
                <div class="episode-card skeleton-card">
                  <div class="skeleton skeleton-card-thumb"></div>
                  <div class="skeleton skeleton-line short"></div>
                  <div class="skeleton skeleton-line"></div>
                </div>
              }
            </div>
          </div>
        } @else if (!isUpcomingTitle() && player.currentItemType() === 'tv' && player.episodes().length > 0 && !episodesPlayDisabled()) {
          <div class="episode-grid-section">
            <div class="episode-grid-heading">
              <h3 class="episode-grid-title">Episodi</h3>
            </div>
            <div class="episode-grid ui-scroll-row ui-scroll-row-thin">
              @for (ep of player.episodes(); track ep.episode_number) {
                <article uiSurface="card"
                         [class.is-disabled]="episodesPlayDisabled()"
                         [attr.role]="episodesPlayDisabled() ? null : 'button'"
                         [attr.tabindex]="episodesPlayDisabled() ? -1 : 0"
                         [attr.aria-disabled]="episodesPlayDisabled()"
                         [class.selected]="ep.episode_number === activeInThisSeason()"
                         [attr.aria-pressed]="ep.episode_number === activeInThisSeason()"
                         (click)="selectEpisode(ep.episode_number)"
                         (keydown.enter)="selectEpisode(ep.episode_number)"
                         (keydown.space)="selectEpisode(ep.episode_number); $event.preventDefault()">
                  <div class="episode-thumb"
                       [class.no-image]="!ep.still_path"
                       [style.background-image]="ep.still_path ? 'url(' + episodeThumbBase + ep.still_path + ')' : null">
                    @if (canClearEpisodeProgress(ep.episode_number)) {
                      <button uiButton="icon-overlay"
                              type="button"
                              [uiPending]="clearProgressPendingKey() === episodeProgressKey(ep.episode_number)"
                              aria-label="Azzera progresso episodio"
                              title="Azzera progresso episodio"
                              (click)="openEpisodeClearProgressModal(ep.episode_number, $event)">
                        <app-icon name="trash"></app-icon>
                      </button>
                    }
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
                </article>
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
            <div class="reviews-row ui-scroll-row ui-scroll-row-thin">
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
            <div class="reviews-row ui-scroll-row ui-scroll-row-thin">
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

      <ui-modal [(open)]="providerPickerOpen" title="Scegli la versione" size="sm">
        <div class="provider-picker">
          <p class="provider-picker-hint">
            Quale di queste &egrave; il titolo giusto? La scelta resta salvata e non verr&agrave; pi&ugrave; ricalcolata automaticamente.
          </p>
          <ul class="provider-picker-list">
            @for (c of providerCandidates(); track c.providerTitleId) {
              <li>
                <button uiSurface="row" type="button" class="provider-picker-row"
                        [class.is-current]="player.providerResolvedTitleId() === c.providerTitleId"
                        [disabled]="providerPickerPending() || providerRefreshPending()"
                        (click)="chooseProviderCandidate(c.providerTitleId)">
                  @if (c.posterUrl) {
                    <img class="provider-picker-thumb" [src]="c.posterUrl" [alt]="c.title" loading="lazy">
                  } @else {
                    <span class="provider-picker-thumb provider-picker-thumb-fallback" aria-hidden="true">
                      <app-icon [name]="player.currentItemType() === 'tv' ? 'tv' : 'film'"></app-icon>
                    </span>
                  }
                  <span class="provider-picker-copy">
                    <span class="provider-picker-title">{{ c.title }}</span>
                    <span class="provider-picker-meta">
                      @if (c.year) { <span>{{ c.year }}</span> }
                      @if (player.providerResolvedTitleId() === c.providerTitleId) {
                        <span class="provider-picker-current">attuale</span>
                      }
                    </span>
                  </span>
                </button>
              </li>
            }
          </ul>
          <div class="provider-picker-footer">
            <span class="provider-picker-footer-hint">Nessuno è quello giusto?</span>
            <button uiButton="ghost" type="button"
                    [uiPending]="providerRefreshPending()"
                    (click)="refreshFromPicker()">
              <app-icon name="rotate-left"></app-icon>
              <span>{{ pickerRefreshLabel() }}</span>
            </button>
          </div>
        </div>
      </ui-modal>

      <ui-confirm-modal
        [(open)]="confirmModalOpen"
        [title]="confirmModalTitle()"
        [message]="confirmModalMessage()"
        [warning]="confirmModalWarning()"
        [actionLabel]="confirmModalActionLabel()"
        (cancelled)="cancelConfirmedAction()"
        (confirmed)="executeConfirmedAction()" />
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
  protected readonly confirmModalOpen = signal(false);
  protected readonly watchlistPending = signal(false);
  protected readonly clearProgressPendingKey = signal<string | null>(null);
  protected readonly providerRefreshPending = signal(false);
  protected readonly providerPickerOpen = signal(false);
  protected readonly providerPickerPending = signal(false);
  private readonly pendingConfirmAction = signal<ConfirmAction | null>(null);

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
    const isUpcoming = isTitleUpcoming(item, type);
    if (this.player.playbackAvailability() === 'unavailable' && !isUpcoming) return '';
    // When the user has caught up with all aired episodes (next-unwatched is
    // null for TV), suppress the "Nuovo episodio!" branch — the
    // message is meant for users who still have to watch the new release.
    const caughtUp = type === 'tv' && this.player.nextUnwatchedRef() === null;
    return getFullReleaseStatusText(item, type, { suppressNewEpisode: caughtUp });
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

  protected readonly showNextButton = computed(() => this.player.nextEpisode() !== null);

  protected readonly canClearProgress = computed(() => {
    if (this.loading() || this.isUpcomingTitle()) return false;
    return this.player.resumeProgress() !== null;
  });

  protected readonly confirmModalTitle = computed(() => {
    const action = this.pendingConfirmAction();
    if (action?.type === 'remove-watchlist') return 'Rimuovi Dalla Lista';
    if (action?.type === 'refresh-provider') return 'Cerca Versioni';
    return 'Riparti Dall\'Inizio';
  });

  protected readonly confirmModalMessage = computed(() => {
    const action = this.pendingConfirmAction();
    if (action?.type === 'remove-watchlist') {
      return `Vuoi rimuovere ${this.title()} dalla tua lista?`;
    }
    if (action?.type === 'refresh-provider') {
      return 'Vuoi cercare di nuovo le versioni disponibili per questo titolo?';
    }
    if (this.player.currentItemType() === 'tv') {
      const season = action?.type === 'clear-progress' ? (action.season ?? this.player.selectedSeason()) : this.player.selectedSeason();
      const episode = action?.type === 'clear-progress' ? (action.episode ?? this.player.selectedEpisode()) : this.player.selectedEpisode();
      return `Vuoi ripartire dall'inizio per S${season} E${episode}?`;
    }
    return 'Vuoi ripartire dall\'inizio per questo film?';
  });

  protected readonly confirmModalWarning = computed(() => {
    const action = this.pendingConfirmAction()?.type;
    if (action === 'remove-watchlist') {
      return 'Potrai sempre riaggiungerlo più tardi.';
    }
    if (action === 'refresh-provider') {
      return 'Usalo solo se pensi che siano comparse nuove versioni del titolo.';
    }
    return 'Ripartirai dall’inizio al prossimo play.';
  });

  protected readonly confirmModalActionLabel = computed(() => {
    const action = this.pendingConfirmAction()?.type;
    if (action === 'remove-watchlist') return 'Rimuovi';
    if (action === 'refresh-provider') return 'Riprova';
    return 'Resetta';
  });

  protected readonly clearProgressButtonLabel = computed(() => {
    return 'Riparti dall\'inizio';
  });

  protected readonly movieProgressPct = computed(() => {
    if (this.player.currentItemType() !== 'movie') return null;
    const progress = this.player.resumeProgress();
    if (!progress || progress.duration <= 0) return null;
    return Math.min(100, Math.max(0, (progress.position / progress.duration) * 100));
  });

  protected readonly movieProgressLabel = computed(() => {
    if (this.player.currentItemType() !== 'movie') return '';
    const progress = this.player.resumeProgress();
    if (!progress || progress.duration <= 0) return '';
    const base = `${formatTime(progress.position)}/${formatTime(progress.duration)}`;
    if (progress.position <= 0) return base;
    const pct = Math.min(100, Math.max(0, Math.round((progress.position / progress.duration) * 100)));
    return `${base} · ${pct}%`;
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

  protected readonly canStartPlayback = computed(() => this.player.playbackAvailability() === 'ready');
  protected readonly episodesPlayDisabled = computed(() => this.player.playbackAvailability() === 'unavailable');
  protected readonly showManualProviderRefresh = computed(() => (
    !this.isUpcomingTitle()
    && !this.player.selectedEpisodeUpcoming()
    && this.player.playbackAvailability() === 'unavailable'
    && this.player.playbackUnavailableReason() === 'not_found'
    && this.player.providerManualRefreshState() !== null
    && this.player.providerCandidates().length === 0
  ));
  protected readonly manualProviderRefreshLabel = computed(() => (
    this.showManualProviderRefresh() ? 'Cerca versioni' : ''
  ));

  protected readonly providerCandidates = computed(() => this.player.providerCandidates());
  protected readonly showProviderPicker = computed(() => {
    // Hide the whole picker affordance for content that hasn't released
    // yet — either the whole title (movie/series not out) or the specific
    // episode/season the user is pointing at. In both cases "Titolo non
    // disponibile" is a release-timing issue, not a provider matching
    // issue, so offering to pick a version is misleading.
    if (this.isUpcomingTitle() || this.player.selectedEpisodeUpcoming()) return false;
    const candidates = this.providerCandidates();
    if (candidates.length === 0) return false;
    const currentId = this.player.providerResolvedTitleId();
    // If the only candidate is the one already confirmed, the picker would
    // show a single row marked "attuale" with nothing else to choose — hide
    // the button so the UI doesn't promise a meaningful action.
    if (candidates.length === 1 && candidates[0].providerTitleId === currentId) return false;
    return true;
  });
  protected readonly providerPickerButtonLabel = computed(() => (
    this.player.providerMatchStatus() === 'failed' ? 'Scegli versione' : 'Cambia versione'
  ));
  protected readonly pickerRefreshLabel = computed(() => 'Aggiorna lista versioni');

  protected readonly showUnavailableHint = computed(() => (
    !this.isUpcomingTitle()
    && !this.player.selectedEpisodeUpcoming()
    && this.player.playbackAvailability() === 'unavailable'
    && this.player.playbackUnavailableReason() === 'not_found'
    && this.providerCandidates().length > 0
  ));
  protected readonly unavailableHint = computed(() => (
    'Potrebbe essere disponibile con un titolo diverso — scegli la versione giusta dalla lista.'
  ));

  protected readonly primaryPlayLabel = computed(() => {
    if (this.player.playbackAvailability() === 'unavailable') {
      return this.player.playbackUnavailableMessage() ?? 'Titolo non disponibile';
    }
    return this.playLabel();
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

    // Compute how many episodes have already aired, considering next_episode_to_air
    // if its air_date is today or past.
    const aired = it ? getAiredEpisodesCount(it) : 0;

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
    this.recommendations.set(results.slice(0, 20).map(it => tmdbToCardItem(it, type, true)));
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
    if (this.player.isInWatchlist()) {
      this.pendingConfirmAction.set({ type: 'remove-watchlist' });
      this.confirmModalOpen.set(true);
      return;
    }
    void runWithPending(this.watchlistPending, () => this.player.toggleWatchlist());
  }

  protected openClearProgressModal(): void {
    this.pendingConfirmAction.set({ type: 'clear-progress' });
    this.confirmModalOpen.set(true);
  }

  protected openEpisodeClearProgressModal(episodeNumber: number, event: Event): void {
    event.stopPropagation();
    this.pendingConfirmAction.set({
      type: 'clear-progress',
      season: this.player.selectedSeason(),
      episode: episodeNumber
    });
    this.confirmModalOpen.set(true);
  }

  protected triggerManualProviderRefresh(): void {
    if (this.providerRefreshPending()) return;
    if (this.player.providerManualRefreshState()?.requiresConfirm) {
      this.pendingConfirmAction.set({ type: 'refresh-provider' });
      this.confirmModalOpen.set(true);
      return;
    }
    void runWithPending(this.providerRefreshPending, () => this.player.refreshProviderTitleResolution());
  }

  protected openProviderPicker(): void {
    if (this.providerCandidates().length === 0) return;
    this.providerPickerOpen.set(true);
  }

  protected closeProviderPicker(): void {
    this.providerPickerOpen.set(false);
  }

  protected chooseProviderCandidate(providerTitleId: number): void {
    if (this.providerPickerPending()) return;
    const sameAsCurrent = this.player.providerResolvedTitleId() === providerTitleId;
    const playable = this.player.playbackAvailability() === 'ready';
    if (sameAsCurrent && playable) {
      // Already confirmed and working — nothing to do, close modal.
      this.providerPickerOpen.set(false);
      return;
    }
    // Same candidate but playback was broken last time: let the click
    // retry, in case the upstream issue (e.g., transient missing season
    // payload) has cleared.
    void runWithPending(this.providerPickerPending, async () => {
      const ok = await this.player.manuallyConfirmProvider(providerTitleId);
      if (ok) this.providerPickerOpen.set(false);
    });
  }

  protected refreshFromPicker(): void {
    if (this.providerRefreshPending()) return;
    if (this.player.providerManualRefreshState()?.requiresConfirm) {
      this.pendingConfirmAction.set({ type: 'refresh-provider' });
      this.confirmModalOpen.set(true);
      return;
    }
    // Stay in the modal — the candidates signal will repopulate from the
    // refresh response and the list updates in place.
    void runWithPending(this.providerRefreshPending, () => this.player.refreshProviderTitleResolution());
  }

  protected cancelConfirmedAction(): void {
    this.pendingConfirmAction.set(null);
  }

  protected executeConfirmedAction(): void {
    const action = this.pendingConfirmAction();
    this.pendingConfirmAction.set(null);
    if (action?.type === 'remove-watchlist') {
      void runWithPending(this.watchlistPending, () => this.player.toggleWatchlist());
      return;
    }
    if (action?.type === 'refresh-provider') {
      void runWithPending(this.providerRefreshPending, () => this.player.refreshProviderTitleResolution());
      return;
    }
    if (action?.type === 'clear-progress') {
      const key = this.player.currentItemType() === 'tv' && action.episode
        ? progressKey(action.season ?? this.player.selectedSeason(), action.episode)
        : 'movie';
      this.clearProgressPendingKey.set(key);
      void (async () => {
        try {
          if (this.player.currentItemType() === 'tv' && action.episode) {
            await this.player.clearEpisodeProgress(action.season ?? this.player.selectedSeason(), action.episode);
          } else {
            await this.player.clearSelectedProgress();
          }
        } finally {
          this.clearProgressPendingKey.set(null);
        }
      })();
    }
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

  protected readonly seasonOptions = computed<UiSelectOption<number>[]>(() =>
    this.player.seasons().map((s) => ({ value: s, label: `Stagione ${s}` }))
  );

  protected onSeasonChange(season: number | null): void {
    if (season === null) return;
    void this.player.changeSeason(season);
  }

  protected selectEpisode(episodeNumber: number): void {
    if (this.episodesPlayDisabled()) return;
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
    const p = this.player.seriesProgress().get(progressKey(this.player.selectedSeason(), episodeNumber));
    if (!p || p.duration <= 0) return 0;
    return Math.min(100, Math.max(0, (p.position / p.duration) * 100));
  }

  protected episodeProgressLabel(ep: { episode_number: number; runtime?: number | null }): string {
    const progress = this.player.seriesProgress().get(progressKey(this.player.selectedSeason(), ep.episode_number));
    const totalSeconds = progress?.duration && progress.duration > 0
      ? progress.duration
      : (ep.runtime && ep.runtime > 0 ? ep.runtime * 60 : 0);
    if (totalSeconds <= 0) return '';
    const watchedSeconds = progress?.position && progress.position > 0 ? progress.position : 0;
    const base = `${formatTime(watchedSeconds)}/${formatTime(totalSeconds)}`;
    if (watchedSeconds <= 0) return base;
    const pct = Math.min(100, Math.max(0, Math.round((watchedSeconds / totalSeconds) * 100)));
    return `${base} · ${pct}%`;
  }

  protected canClearEpisodeProgress(episodeNumber: number): boolean {
    const progress = this.player.seriesProgress().get(progressKey(this.player.selectedSeason(), episodeNumber));
    return !!progress && progress.position > 0;
  }

  protected episodeProgressKey(episodeNumber: number): string {
    return progressKey(this.player.selectedSeason(), episodeNumber);
  }
}

