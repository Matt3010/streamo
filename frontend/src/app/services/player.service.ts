import { Injectable, signal, computed, inject, untracked } from '@angular/core';
import { TmdbService } from './tmdb.service';
import {
  ProviderResolveService,
  type ProviderManualRefreshState,
  type ProviderMatchStatus,
  type ProviderResolvedTitleCandidate
} from './provider-resolve.service';
import { ProgressService } from './progress.service';
import { WatchlistService } from './watchlist.service';
import { HistoryService } from './history.service';
import { AuthService } from './auth.service';
import { ToastService } from './toast.service';
import { isTitleUpcoming } from '../utils/media-release.util';
import { isFutureDateStr } from '../utils/date.util';
import { getEffectiveLastEpisode } from '../utils/aired-episodes.util';
import { formatTime, progressKey } from '../utils/time.util';
import type { MediaType, ProviderResolveFailureReason, TmdbItem, TmdbEpisodeDetail, PlayerEventMessage } from '../models';
import { tmdbImageUrl } from '../../../../shared/tmdb-image';

// Mirror of the backend's 93% watched/completed threshold. Used to decide
// when to advance the CTA mid-playback so the watch page stays aligned with
// watchlist/history/continue logic.
const CONTINUE_HIDE_THRESHOLD = 0.93;

interface ProviderPlaybackTitle {
  provider: 'streamingcommunity';
  id: number;
  slug: string | null;
  title: string;
  mediaType: MediaType;
}

type PlaybackAvailability = 'idle' | 'resolving' | 'ready' | 'unavailable';

@Injectable({ providedIn: 'root' })
export class PlayerService {
  private tmdb = inject(TmdbService);
  private providerResolve = inject(ProviderResolveService);
  private progress = inject(ProgressService);
  private watchlist = inject(WatchlistService);
  private history = inject(HistoryService);
  private auth = inject(AuthService);
  private toast = inject(ToastService);

  // Player state (now driven by the watch route — no more modal flag).
  readonly currentItem = signal<TmdbItem | null>(null);
  readonly currentItemType = signal<MediaType | null>(null);

  // Backdrop image url
  readonly backdropUrl = signal('');

  // TV controls
  readonly seasons = signal<number[]>([]);
  // Each entry carries the full TMDB episode payload (name, overview,
  // still_path, …) so the watch page can render rich episode cards rather
  // than a bare number dropdown. Stub objects with only `episode_number` are
  // used as a fallback when the season-details fetch fails.
  readonly episodes = signal<TmdbEpisodeDetail[]>([]);
  readonly selectedSeason = signal(1);
  readonly selectedEpisode = signal(1);

  // Pending iframe URL (set after openPlayer + loadProgress) and live src.
  // `urlSeq` invalidates in-flight `applyResumeProgress` calls when the URL
  // base changes (open, changeSeason, changeEpisode, maybeAutoPlayNext).
  private pendingVideoUrl = '';
  private playbackTitle: ProviderPlaybackTitle | null = null;
  private urlSeq = 0;
  readonly iframeSrc = signal('');
  readonly playbackAvailability = signal<PlaybackAvailability>('idle');
  readonly playbackUnavailableMessage = signal<string | null>(null);
  // Becomes true once the initial open() flow for the current title has
  // finished its dependent fetches (TMDB details + provider resolve +
  // progress + next-unwatched). The watch page uses this to keep the
  // action-button skeleton in place across the entire load — without it,
  // currentItem flips first and the play button briefly renders its
  // fallback label ("Guarda") before nextUnwatchedRef arrives.
  readonly initialLoadComplete = signal(false);
  readonly playbackUnavailableReason = signal<ProviderResolveFailureReason | null>(null);
  readonly providerManualRefreshState = signal<ProviderManualRefreshState | null>(null);
  readonly providerCandidates = signal<ProviderResolvedTitleCandidate[]>([]);
  readonly providerMatchStatus = signal<ProviderMatchStatus | null>(null);
  readonly providerResolvedTitleId = signal<number | null>(null);

  // Playback tracking
  readonly resumeText = signal('');
  // Saved progress for the *current* selected episode. Drives the
  // "Riprendi da hh:mm:ss" button label and the "Vai al prossimo" decision.
  readonly resumeProgress = signal<{ position: number; duration: number } | null>(null);
  // Per-episode progress map for the currently-loaded series, keyed by
  // `s${season}e${episode}`. Powers the progress bars rendered at the
  // bottom of every episode card. Mutated locally as the user watches so
  // bars update in real time without re-fetching.
  readonly seriesProgress = signal<ReadonlyMap<string, { position: number; duration: number }>>(new Map());
  // The "next unwatched" episode for this series — pinned at open() time
  // and refreshed only when an episode actually completes. The primary CTA
  // always points here, regardless of which card the user has selected, so
  // they have one stable "continue" entry-point even while exploring older
  // episodes via the card grid. null for movies, fresh shows, or fully
  // completed series.
  readonly nextUnwatchedRef = signal<{ season: number; episode: number } | null>(null);
  // The {season, episode} pair currently *loaded* in the player (or the
  // initial target before first play). Drives the red "selected" highlight
  // on episode cards. Diverges from selectedSeason/selectedEpisode when the
  // user uses the season dropdown to *browse* a season without playing an
  // episode in it — selectedEpisode then resets to 1 (URL preload), but the
  // highlight stays anchored to whatever the user was last actually
  // watching, only re-appearing on the cards when they navigate back to its
  // own season.
  readonly activeEpisodeRef = signal<{ season: number; episode: number } | null>(null);
  // Next playable episode coordinates given the currently-loaded series and
  // the active selectedSeason/selectedEpisode. null for movies, finales, or
  // before TV details are loaded.
  readonly nextEpisode = computed<{ season: number; episode: number } | null>(() => {
    if (this.currentItemType() !== 'tv') return null;
    const item = this.currentItem();
    const seasons = item?.seasons ?? [];
    if (!seasons.length) return null;
    const cs = this.selectedSeason();
    const ce = this.selectedEpisode();
    // Prefer the live (already-aired) episode list for the current season so
    // we don't suggest jumping to an episode TMDB lists in the season but
    // hasn't aired yet.
    const eps = this.episodes();
    if (eps.some(e => e.episode_number === ce + 1)) {
      return { season: cs, episode: ce + 1 };
    }
    const last = item ? getEffectiveLastEpisode(item) : null;
    const future = seasons
      .filter(s => s.season_number > cs && (s.episode_count ?? 0) > 0)
      // If we know the latest aired episode, only consider seasons up to it.
      .filter(s => !last || s.season_number <= (last.season_number ?? Infinity))
      .sort((a, b) => a.season_number - b.season_number)[0];
    return future ? { season: future.season_number, episode: 1 } : null;
  });
  // True when the currently-selected season/episode hasn't aired yet. The
  // series itself may have been airing for years, but the user could be
  // pointing at a future episode (next week, next season, etc.). In that
  // case "Titolo non disponibile" is a release-timing issue — picking a
  // different provider version won't help.
  readonly selectedEpisodeUpcoming = computed<boolean>(() => {
    if (this.currentItemType() !== 'tv') return false;
    const item = this.currentItem();
    if (!item) return false;
    const selectedSeason = this.selectedSeason();
    const selectedEpisode = this.selectedEpisode();

    // 1. Direct check on the loaded episodes' air_date if available.
    const eps = this.episodes();
    const ep = eps.find((e) => e.episode_number === selectedEpisode);
    if (ep?.air_date) {
      return isFutureDateStr(ep.air_date);
    }

    // 2. If the series has NEVER aired an episode (TMDB often leaves
    //    first_air_date null while populating next_episode_to_air for
    //    unreleased shows) the whole thing is upcoming regardless of
    //    which season/episode the user is pointing at.
    const last = item.last_episode_to_air;
    const hasAnyAired = !!(
      last
      && typeof last.season_number === 'number'
      && typeof last.episode_number === 'number'
    );
    if (!hasAnyAired) return true;

    // 3. Selected episode is past the latest aired one.
    if (selectedSeason > last!.season_number!) return true;
    if (selectedSeason === last!.season_number! && selectedEpisode > last!.episode_number!) return true;

    // 4. Fallback: TMDB season metadata says the season hasn't aired yet.
    const season = item.seasons?.find((s) => s.season_number === selectedSeason);
    if (season?.air_date && isFutureDateStr(season.air_date)) return true;

    return false;
  });
  readonly isInWatchlist = signal(false);
  private currentVideoTime = 0;
  private currentVideoDuration = 0;
  private lastSavedTime = 0;
  private videoStartTime: number | null = null;
  private playbackInstanceId = 0;
  private handledCompletionPlaybackId = 0;
  private playbackResolveSeq = 0;
  private playingSeason = 0;
  private playingEpisode = 0;
  private progressSaveInterval: number | null = null;

  // Notify listeners that a save has happened (for refreshing "continue" sections)
  readonly progressTick = signal(0);

  constructor() {
    window.addEventListener('message', (event: MessageEvent) => this.handlePlayerMessage(event));
  }

  // ===== OPEN / CLEANUP =====
  async open(tmdbId: string | number, type: MediaType, resumeSeason = 0, resumeEpisode = 0): Promise<void> {
    // open() is called from the WatchComponent's effect — any signal *read*
    // inside the synchronous prelude gets tracked by that effect, and a
    // following .set() on the same signal will re-fire the effect and call
    // open() again → infinite loop, freezing the whole tab. Wrap reads in
    // untracked() so the effect only stays subscribed to its inputs.
    const outgoing = untracked(() => this.currentItem());
    const outgoingType = untracked(() => this.currentItemType());
    const outgoingStarted = this.videoStartTime !== null;
    const outgoingPosition = this.currentVideoTime;
    const outgoingDuration = this.currentVideoDuration;
    const outgoingSeason = this.playingSeason;
    const outgoingEpisode = this.playingEpisode;
    const isLoggedIn = untracked(() => this.auth.currentUser() !== null);

    // Clear display state so the watch page doesn't flash stale metadata
    // (title/backdrop, the bookmark icon, or season/episode dropdowns from
    // the previous title) while the new fetch is in flight.
    this.currentItem.set(null);
    this.backdropUrl.set('');
    this.isInWatchlist.set(false);
    this.pendingVideoUrl = '';
    this.playbackTitle = null;
    this.playbackResolveSeq += 1;
    this.playbackAvailability.set('resolving');
    this.playbackUnavailableMessage.set(null);
    this.playbackUnavailableReason.set(null);
    this.providerManualRefreshState.set(null);
    this.providerCandidates.set([]);
    this.providerMatchStatus.set(null);
    this.providerResolvedTitleId.set(null);
    this.seasons.set([]);
    this.episodes.set([]);
    this.seriesProgress.set(new Map());
    this.nextUnwatchedRef.set(null);
    this.activeEpisodeRef.set(null);
    this.initialLoadComplete.set(false);

    const item = await this.tmdb.getDetails(tmdbId, type);
    if (!item) {
      this.toast.show('Impossibile caricare il contenuto. Torna indietro e riprova.');
      return;
    }

    // Persist the outgoing item now that the new one is loading. AFTER the
    // await we're past the effect's tracking window.
    if (this.progressSaveInterval !== null) {
      clearInterval(this.progressSaveInterval);
      this.progressSaveInterval = null;
    }
    if (outgoing && outgoingType && outgoingStarted && outgoingPosition > 10 && isLoggedIn) {
      void this.progress.save({
        tmdb_id: outgoing.id,
        media_type: outgoingType,
        season: outgoingType === 'tv' ? outgoingSeason : 0,
        episode: outgoingType === 'tv' ? outgoingEpisode : 0,
        position: outgoingPosition,
        duration: outgoingDuration,
        title: outgoing.title ?? outgoing.name ?? null,
        poster: outgoing.poster_path ?? null,
        backdrop: outgoing.backdrop_path ?? null
      });
    }

    this.currentItem.set(item);
    this.currentItemType.set(type);

    const backdrop = item.backdrop_path ?? item.poster_path;
    this.backdropUrl.set(tmdbImageUrl(backdrop, 'w1280'));

    this.iframeSrc.set('');
    this.videoStartTime = null;
    this.currentVideoTime = 0;
    this.currentVideoDuration = 0;
    this.lastSavedTime = 0;
    this.resumeText.set('');

    // Watchlist status (fire and forget)
    void this.refreshWatchlistStatus(tmdbId, type);

    this.playbackTitle = await this.resolvePlaybackTitle(item, type);

    if (type === 'tv') {
      // Run the two progress fetches in parallel — one drives the CTA target
      // (next-unwatched for this user), the other populates the per-episode
      // progress bars on the card grid. Both are independent reads.
      const [next, rows] = await Promise.all([
        this.progress.getNextUnwatched(tmdbId, 'tv'),
        this.progress.getSeriesProgress(tmdbId)
      ]);
      this.nextUnwatchedRef.set(next);
      const map = new Map<string, { position: number; duration: number }>();
      for (const r of rows) {
        // Mirror the backend's >5s "actually started" gate so a stray
        // 0.5s blip doesn't paint a phantom progress bar on the card.
        if (r.position > 5) {
          map.set(progressKey(r.season, r.episode), { position: r.position, duration: r.duration });
        }
      }
      this.seriesProgress.set(map);

      // No explicit s/e from the URL → land the player on the next-unwatched
      // episode. Lets a card click on the home row "La mia lista" or on the
      // watchlist page resume where they left.
      if (resumeSeason === 0 && resumeEpisode === 0 && next) {
        resumeSeason = next.season;
        resumeEpisode = next.episode;
      }
      await this.setupTVPlayer(tmdbId, item, resumeSeason, resumeEpisode, this.playbackTitle);
    } else {
      this.seasons.set([]);
      this.episodes.set([]);
      if (this.playbackTitle) {
        const seq = ++this.urlSeq;
        const resolveSeq = this.beginPlaybackResolve();
        await this.setMovieUrl(this.playbackTitle, resolveSeq);
        await this.applyResumeProgress(seq, tmdbId, 'movie');
      }
    }

    this.initialLoadComplete.set(true);
  }

  cleanup(): void {
    if (this.progressSaveInterval !== null) {
      clearInterval(this.progressSaveInterval);
      this.progressSaveInterval = null;
    }

    if (this.currentItem() && this.videoStartTime !== null && this.currentVideoTime > 10) {
      void this.persistProgress(this.currentVideoTime, this.currentVideoDuration, this.playingSeason, this.playingEpisode);
    }

    this.iframeSrc.set('');
    this.pendingVideoUrl = '';
    this.playbackTitle = null;
    this.playbackResolveSeq += 1;
    this.playbackAvailability.set('idle');
    this.playbackUnavailableMessage.set(null);
    this.playbackUnavailableReason.set(null);
    this.providerManualRefreshState.set(null);
    this.providerCandidates.set([]);
    this.providerMatchStatus.set(null);
    this.providerResolvedTitleId.set(null);
    // Invalidate any in-flight applyResumeProgress so it can't write to a
    // freshly-cleared pendingVideoUrl after the page is gone.
    this.urlSeq++;
    this.videoStartTime = null;
    this.currentVideoTime = 0;
    this.currentVideoDuration = 0;
    this.lastSavedTime = 0;
    this.playingSeason = 0;
    this.playingEpisode = 0;
    this.currentItem.set(null);
    this.currentItemType.set(null);
    this.resumeText.set('');
    this.resumeProgress.set(null);
    this.seriesProgress.set(new Map());
    this.nextUnwatchedRef.set(null);
    this.activeEpisodeRef.set(null);
    this.progressTick.update(n => n + 1);
  }

  // ===== START / EPISODE =====
  startVideo(): void {
    const item = this.currentItem();
    const type = this.currentItemType();
    if (item && type && isTitleUpcoming(item, type)) {
      this.toast.show(type === 'movie' ? 'Film non ancora disponibile' : 'Serie non ancora disponibile');
      return;
    }
    if (!this.pendingVideoUrl || this.playbackAvailability() !== 'ready') return;
    this.iframeSrc.set(this.pendingVideoUrl);
    this.videoStartTime = Date.now();
    this.playbackInstanceId += 1;
    this.handledCompletionPlaybackId = 0;
    this.currentVideoTime = 0;
    this.currentVideoDuration = 0;
    this.lastSavedTime = 0;

    if (this.currentItemType() === 'tv') {
      this.playingSeason = this.selectedSeason();
      this.playingEpisode = this.selectedEpisode();
    } else {
      this.playingSeason = 0;
      this.playingEpisode = 0;
    }

    if (this.progressSaveInterval !== null) clearInterval(this.progressSaveInterval);
    this.progressSaveInterval = window.setInterval(() => {
      if (this.currentVideoTime > 0 && Math.abs(this.currentVideoTime - this.lastSavedTime) >= 10) {
        void this.persistProgress(this.currentVideoTime, this.currentVideoDuration, this.playingSeason, this.playingEpisode);
        this.lastSavedTime = this.currentVideoTime;
      }
    }, 15000);
  }

  async changeSeason(season: number): Promise<void> {
    const item = this.currentItem();
    if (!item) return;
    if (!this.seasons().includes(season)) return;
    this.saveCurrentEpisodeProgress();

    this.selectedSeason.set(season);
    const seasonData = await this.tmdb.getSeasonDetails(item.id, season);
    const aired = airedEpisodes(seasonData?.episodes, season, getEffectiveLastEpisode(item));
    const fallbackCount = (item.seasons ?? []).find(s => s.season_number === season)?.episode_count ?? 10;
    this.episodes.set(aired.length ? aired : episodeStubs(fallbackCount));
    this.selectedEpisode.set(1);

    this.resetPlayer();
    const seq = ++this.urlSeq;
    const resolveSeq = this.beginPlaybackResolve();
    const playback = this.requirePlaybackTitle();
    if (playback) {
      await this.setEpisodeUrl(playback, season, 1, resolveSeq);
    }
    await this.applyResumeProgress(seq, item.id, 'tv', season, 1);
  }

  async changeEpisode(episode: number): Promise<void> {
    const item = this.currentItem();
    if (!item) return;
    this.saveCurrentEpisodeProgress();

    this.selectedEpisode.set(episode);
    const season = this.selectedSeason();
    this.activeEpisodeRef.set({ season, episode });
    this.resetPlayer();
    const seq = ++this.urlSeq;
    const resolveSeq = this.beginPlaybackResolve();
    const playback = this.requirePlaybackTitle();
    if (playback) {
      await this.setEpisodeUrl(playback, season, episode, resolveSeq);
    }
    await this.applyResumeProgress(seq, item.id, 'tv', season, episode);
  }

  // ===== WATCHLIST =====
  async toggleWatchlist(): Promise<void> {
    if (!this.auth.currentUser()) {
      this.toast.show('Accedi per usare la watchlist');
      return;
    }
    const item = this.currentItem();
    const type = this.currentItemType();
    if (!item || !type) return;

    const title = item.title ?? item.name ?? '';
    const poster = item.poster_path ?? null;

    if (this.isInWatchlist()) {
      const ok = await this.watchlist.remove(item.id, type);
      if (!ok) {
        this.toast.show('Errore di rete, riprova');
        return;
      }
      this.isInWatchlist.set(false);
      this.toast.show('Rimosso dalla lista');
    } else {
      const ok = await this.watchlist.add(item.id, type, title, poster);
      if (!ok) {
        this.toast.show('Errore di rete, riprova');
        return;
      }
      this.isInWatchlist.set(true);
      this.toast.show('Aggiunto alla lista');
    }
  }

  async clearSelectedProgress(): Promise<void> {
    if (!this.auth.currentUser()) {
      this.toast.show('Accedi per gestire il progresso');
      return;
    }

    const item = this.currentItem();
    const type = this.currentItemType();
    if (!item || !type) return;

    if (type === 'movie') {
      this.resetPlayer();
      this.urlSeq++;
      this.resumeProgress.set(null);
      this.resumeText.set('');
      const ok = await this.progress.remove(item.id, 'movie');
      const playback = this.requirePlaybackTitle();
      if (playback) {
        const resolveSeq = this.beginPlaybackResolve();
        void this.setMovieUrl(playback, resolveSeq);
      }
      this.progressTick.update(n => n + 1);
      this.toast.show(ok ? 'Progresso film azzerato' : 'Errore di rete, riprova');
      return;
    }

    const season = this.selectedSeason();
    const episode = this.selectedEpisode();
    this.resetPlayer();
    this.urlSeq++;
    this.resumeProgress.set(null);
    this.resumeText.set('');
    this.seriesProgress.update(prev => {
      const next = new Map(prev);
      next.delete(progressKey(season, episode));
      return next;
    });

    const ok = await this.progress.remove(item.id, 'tv', season, episode);
    await this.refreshNextUnwatchedRef();
    const playback = this.requirePlaybackTitle();
    if (playback) {
      const resolveSeq = this.beginPlaybackResolve();
      void this.setEpisodeUrl(playback, season, episode, resolveSeq);
    }
    this.progressTick.update(n => n + 1);
    this.toast.show(ok ? `Progresso S${season} E${episode} azzerato` : 'Errore di rete, riprova');
  }

  async clearEpisodeProgress(season: number, episode: number): Promise<void> {
    if (!this.auth.currentUser()) {
      this.toast.show('Accedi per gestire il progresso');
      return;
    }

    const item = this.currentItem();
    if (!item || this.currentItemType() !== 'tv') return;
    const isCurrentEpisode = season === this.selectedSeason() && episode === this.selectedEpisode();
    if (isCurrentEpisode) {
      this.resetPlayer();
      this.urlSeq++;
      this.resumeProgress.set(null);
      this.resumeText.set('');
    }

    this.seriesProgress.update(prev => {
      const next = new Map(prev);
      next.delete(progressKey(season, episode));
      return next;
    });

    const ok = await this.progress.remove(item.id, 'tv', season, episode);
    await this.refreshNextUnwatchedRef();
    if (isCurrentEpisode) {
      const playback = this.requirePlaybackTitle();
      if (playback) {
        const resolveSeq = this.beginPlaybackResolve();
        void this.setEpisodeUrl(playback, season, episode, resolveSeq);
      }
    }
    this.progressTick.update(n => n + 1);
    this.toast.show(ok ? `Progresso S${season} E${episode} azzerato` : 'Errore di rete, riprova');
  }

  // ===== PRIVATE =====
  private async setupTVPlayer(
    tmdbId: string | number,
    item: TmdbItem,
    resumeSeason: number,
    resumeEpisode: number,
    playback: ProviderPlaybackTitle | null
  ): Promise<void> {
    const seasonsList = availableSeasons(item);
    const seasonNumbers = seasonsList.length ? seasonsList.map(s => s.season_number) : [1];
    this.seasons.set(seasonNumbers);

    const targetSeason = resumeSeason > 0 && seasonNumbers.includes(resumeSeason)
      ? resumeSeason
      : (seasonNumbers[0] ?? 1);
    this.selectedSeason.set(targetSeason);

    const seasonData = await this.tmdb.getSeasonDetails(Number(tmdbId), targetSeason);
    const aired = airedEpisodes(seasonData?.episodes, targetSeason, getEffectiveLastEpisode(item));
    const fallback = seasonsList.find(s => s.season_number === targetSeason)?.episode_count ?? 10;
    this.episodes.set(aired.length ? aired : episodeStubs(fallback));

    const targetEpisode = resumeEpisode > 0 ? resumeEpisode : 1;
    this.selectedEpisode.set(targetEpisode);
    this.activeEpisodeRef.set({ season: targetSeason, episode: targetEpisode });

    if (playback) {
      const seq = ++this.urlSeq;
      const resolveSeq = this.beginPlaybackResolve();
      await this.setEpisodeUrl(playback, targetSeason, targetEpisode, resolveSeq);
      await this.applyResumeProgress(seq, tmdbId, 'tv', targetSeason, targetEpisode);
    }
  }

  private async setEpisodeUrl(
    playback: ProviderPlaybackTitle,
    season: number,
    episode: number,
    resolveSeq: number
  ): Promise<boolean> {
    const result = await this.resolveEpisodeEmbedUrl(playback, season, episode);
    if (!this.isCurrentPlaybackResolve(resolveSeq)) {
      return false;
    }

    if (!result.embedUrl) {
      this.setPlaybackUnavailable(result.reason);
      return false;
    }

    return this.commitResolvedPlaybackUrl(result.embedUrl, resolveSeq);
  }

  private async setMovieUrl(playback: ProviderPlaybackTitle, resolveSeq: number): Promise<boolean> {
    const result = await this.resolveMovieEmbedUrl(playback);
    if (!this.isCurrentPlaybackResolve(resolveSeq)) {
      return false;
    }

    if (!result.embedUrl) {
      this.setPlaybackUnavailable(result.reason);
      return false;
    }

    return this.commitResolvedPlaybackUrl(result.embedUrl, resolveSeq);
  }

  private async resolveEpisodeEmbedUrl(
    playback: ProviderPlaybackTitle,
    season: number,
    episode: number
  ): Promise<{ embedUrl: string | null; reason: ProviderResolveFailureReason | null }> {
    const resolved = await this.providerResolve.resolveEpisode(
      playback.id,
      playback.slug,
      season,
      episode
    );

    return {
      embedUrl: resolved.resolved?.embedUrl ?? null,
      reason: resolved.reason
    };
  }

  private async resolveMovieEmbedUrl(
    playback: ProviderPlaybackTitle
  ): Promise<{ embedUrl: string | null; reason: ProviderResolveFailureReason | null }> {
    const resolved = await this.providerResolve.resolveMovie(playback.id);
    return {
      embedUrl: resolved.resolved?.embedUrl ?? null,
      reason: resolved.reason
    };
  }

  private beginPlaybackResolve(): number {
    this.playbackResolveSeq += 1;
    this.playbackAvailability.set('resolving');
    this.playbackUnavailableMessage.set(null);
    this.playbackUnavailableReason.set(null);
    return this.playbackResolveSeq;
  }

  private isCurrentPlaybackResolve(resolveSeq: number): boolean {
    return resolveSeq === this.playbackResolveSeq;
  }

  private commitResolvedPlaybackUrl(embedUrl: string, resolveSeq: number): boolean {
    if (!this.isCurrentPlaybackResolve(resolveSeq)) {
      return false;
    }

    this.pendingVideoUrl = embedUrl;
    this.playbackAvailability.set('ready');
    this.playbackUnavailableMessage.set(null);
    this.playbackUnavailableReason.set(null);
    return true;
  }

  private setPlaybackUnavailable(reason: ProviderResolveFailureReason | null): void {
    this.playbackAvailability.set('unavailable');
    this.playbackUnavailableReason.set(reason ?? 'not_found');
    this.playbackUnavailableMessage.set(
      reason === 'temporarily_unavailable'
        ? 'Riproduzione temporaneamente non disponibile'
        : 'Titolo non disponibile'
    );
  }

  private async applyResumeProgress(seq: number, tmdbId: string | number, type: MediaType, season = 0, episode = 0): Promise<void> {
    // No early gate on `auth.currentUser()` here — on a hard refresh the
    // signal is briefly null while AuthService.checkAuth() resolves, but the
    // session cookie is already on the request, so the fetch returns the
    // real progress. Gating on currentUser dropped resume state intermittently
    // when refreshing /watch/<…>?s=N&e=M. progress.get() returns null on 401
    // for actually-logged-out users, which is fine.
    const progress = await this.progress.get(tmdbId, type, season, episode);
    // Bail out if a newer base URL was set while we were awaiting the fetch.
    if (seq !== this.urlSeq) return;
    if (progress && progress.position > 10) {
      this.resumeProgress.set({ position: progress.position, duration: progress.duration });
      this.resumeText.set(`Riprendi da ${formatTime(progress.position)}`);
      if (this.pendingVideoUrl) {
        const startTime = Math.floor(progress.position);
        const sep = this.pendingVideoUrl.includes('?') ? '&' : '?';
        this.pendingVideoUrl += `${sep}start=${startTime}`;
      }
    } else {
      this.resumeProgress.set(null);
      this.resumeText.set('');
    }
  }

  // CTA entry-point. Always plays the next-unwatched episode (locked at
  // open() time) regardless of which card the user has clicked through to.
  // Falls back to startVideo() — meaning whatever's currently in
  // pendingVideoUrl, typically S1E1 — for movies and fresh shows.
  async playPrimary(): Promise<void> {
    const ref = untracked(() => this.nextUnwatchedRef());
    if (this.currentItemType() === 'tv' && ref) {
      // Re-align the loaded URL with the CTA target only when they differ.
      // changeSeason resets the episode list & defaults to E1, so we
      // sequence it before changeEpisode and re-read selectedEpisode()
      // afterwards to skip a redundant changeEpisode(1) call.
      if (ref.season !== untracked(() => this.selectedSeason())) {
        await this.changeSeason(ref.season);
      }
      if (ref.episode !== untracked(() => this.selectedEpisode())) {
        await this.changeEpisode(ref.episode);
      }
    }
    this.startVideo();
  }

  // Card click — load the chosen episode and start it immediately. The
  // resume seek (applyResumeProgress inside changeEpisode) is preserved so
  // re-clicking a half-watched card picks up where the user left off.
  async playEpisodeFromCard(episodeNumber: number): Promise<void> {
    if (episodeNumber !== untracked(() => this.selectedEpisode())) {
      await this.changeEpisode(episodeNumber);
    }
    this.startVideo();
  }

  // Tear down the iframe without leaving the watch page — flushes the last
  // bit of progress, kills the periodic save interval, then re-arms the
  // pendingVideoUrl + resume seek so the next "Riprendi"/"Guarda" click
  // starts from where the user just stopped. The watch page itself stays
  // mounted (currentItem is preserved), so the user is back to the same
  // CTA + episode grid they came from.
  async stopPlayback(): Promise<void> {
    if (this.videoStartTime !== null && this.currentVideoTime > 10) {
      await this.persistProgress(
        this.currentVideoTime,
        this.currentVideoDuration,
        this.playingSeason,
        this.playingEpisode
      );
    }
    this.resetPlayer();

    const item = untracked(() => this.currentItem());
    const type = untracked(() => this.currentItemType());
    if (!item || !type) return;
    const playback = this.requirePlaybackTitle();
    if (!playback) return;

    if (type === 'tv') {
      // The save above may have pushed the just-watched episode past
      // the shared 93% completion threshold; without this refresh the CTA stays anchored to
      // the episode the user just finished until a hard reload.
      await this.refreshNextUnwatchedRef();
      const season = untracked(() => this.selectedSeason());
      const episode = untracked(() => this.selectedEpisode());
      const resolveSeq = this.beginPlaybackResolve();
      const prepared = await this.setEpisodeUrl(playback, season, episode, resolveSeq);
      if (!prepared) return;
      const seq = ++this.urlSeq;
      await this.applyResumeProgress(seq, item.id, 'tv', season, episode);
    } else {
      const resolveSeq = this.beginPlaybackResolve();
      const prepared = await this.setMovieUrl(playback, resolveSeq);
      if (!prepared) return;
      const seq = ++this.urlSeq;
      await this.applyResumeProgress(seq, item.id, 'movie');
    }
  }

  // Switch the player to the next episode and start it from the beginning.
  // Used by the preview "Vai al prossimo" button to jump straight to the
  // next episode instead of resuming the current one.
  async playNextEpisode(): Promise<boolean> {
    const next = untracked(() => this.nextEpisode());
    const item = untracked(() => this.currentItem());
    if (!next || !item) return false;
    const playback = this.requirePlaybackTitle();
    if (!playback) return false;

    const seasonChanged = next.season !== this.selectedSeason();
    let nextSeasonEpisodes: TmdbEpisodeDetail[] | null = null;

    if (seasonChanged) {
      const seasonData = await this.tmdb.getSeasonDetails(item.id, next.season);
      const aired = airedEpisodes(seasonData?.episodes, next.season, getEffectiveLastEpisode(item));
      const fallback = (item.seasons ?? []).find(s => s.season_number === next.season)?.episode_count ?? 10;
      nextSeasonEpisodes = aired.length ? aired : episodeStubs(fallback);
    }

    const resolveSeq = this.beginPlaybackResolve();
    const nextResult = await this.resolveEpisodeEmbedUrl(playback, next.season, next.episode);
    if (!this.isCurrentPlaybackResolve(resolveSeq)) return false;
    if (!nextResult.embedUrl) {
      this.setPlaybackUnavailable(nextResult.reason);
      return false;
    }

    this.saveCurrentEpisodeProgress();
    this.selectedSeason.set(next.season);
    this.selectedEpisode.set(next.episode);
    this.activeEpisodeRef.set(next);
    if (nextSeasonEpisodes) {
      this.episodes.set(nextSeasonEpisodes);
    }

    if (!this.isCurrentPlaybackResolve(resolveSeq)) return false;
    this.resetPlayer();
    if (!this.commitResolvedPlaybackUrl(nextResult.embedUrl, resolveSeq)) return false;
    // No applyResumeProgress — we want a clean start, not a seek to a
    // half-watched checkpoint of an episode the user explicitly skipped.
    this.urlSeq++;
    this.resumeText.set('');
    this.resumeProgress.set(null);
    this.startVideo();
    return true;
  }

  private async refreshWatchlistStatus(tmdbId: string | number, type: MediaType): Promise<void> {
    // Don't gate on `auth.currentUser()` here — on hard refresh the signal
    // is null until AuthService.checkAuth() resolves, but the cookie is on
    // the request, so watchlist.check() returns the real flag. Gating dropped
    // the bookmark "active" state intermittently on /watch reloads.
    this.isInWatchlist.set(await this.watchlist.check(tmdbId, type));
  }

  private async resolvePlaybackTitle(item: TmdbItem, type: MediaType): Promise<ProviderPlaybackTitle | null> {
    const title = (item.title ?? item.name ?? '').trim();
    if (!title) {
      this.providerManualRefreshState.set(null);
      this.setPlaybackUnavailable('not_found');
      return null;
    }

    const result = await this.providerResolve.resolve(
      item.id,
      type,
      title,
      item.release_date ?? item.first_air_date ?? null
    );
    this.providerManualRefreshState.set(result.manualRefresh);
    this.providerCandidates.set(result.candidates);
    this.providerMatchStatus.set(result.matchStatus);
    this.providerResolvedTitleId.set(result.resolved?.id ?? null);

    if (!result.resolved) {
      this.setPlaybackUnavailable(result.reason);
      return null;
    }

    this.playbackAvailability.set('resolving');
    this.playbackUnavailableMessage.set(null);
    this.playbackUnavailableReason.set(null);
    return result.resolved;
  }

  async refreshProviderTitleResolution(): Promise<boolean> {
    const item = this.currentItem();
    const type = this.currentItemType();
    if (!item || !type) return false;

    const title = (item.title ?? item.name ?? '').trim();
    if (!title) {
      this.setPlaybackUnavailable('not_found');
      return false;
    }

    const previousCandidateIds = this.providerCandidates().map((c) => c.providerTitleId).sort().join(',');

    const result = await this.providerResolve.refreshResolve(
      item.id,
      type,
      title,
      item.release_date ?? item.first_air_date ?? null
    );
    this.providerManualRefreshState.set(result.manualRefresh);
    this.providerCandidates.set(result.candidates);
    this.providerMatchStatus.set(result.matchStatus);
    this.providerResolvedTitleId.set(result.resolved?.id ?? null);

    const newCandidateIds = result.candidates.map((c) => c.providerTitleId).sort().join(',');
    const candidatesChanged = previousCandidateIds !== newCandidateIds;

    if (!result.resolved) {
      this.setPlaybackUnavailable(result.reason);
      if (result.reason === 'temporarily_unavailable') {
        this.toast.show('Impossibile aggiornare la ricerca');
      } else {
        this.toast.show(candidatesChanged ? 'Lista versioni aggiornata' : 'Nessuna nuova versione trovata');
      }
      return false;
    }

    const prepared = await this.tryApplyResolvedTitle(item.id, type, result.resolved);
    if (prepared) {
      this.toast.show(candidatesChanged ? 'Lista versioni aggiornata' : 'Versione confermata');
    } else {
      this.toast.show('Questa versione non ha contenuto disponibile.');
    }
    return prepared;
  }

  async manuallyConfirmProvider(providerTitleId: number): Promise<boolean> {
    const item = this.currentItem();
    const type = this.currentItemType();
    if (!item || !type) return false;

    const result = await this.providerResolve.manualConfirm(item.id, type, providerTitleId);
    this.providerManualRefreshState.set(result.manualRefresh);
    this.providerCandidates.set(result.candidates);
    this.providerMatchStatus.set(result.matchStatus);
    this.providerResolvedTitleId.set(result.resolved?.id ?? null);

    if (!result.resolved) {
      this.setPlaybackUnavailable(result.reason);
      this.toast.show('Impossibile confermare la versione');
      return false;
    }

    const prepared = await this.tryApplyResolvedTitle(item.id, type, result.resolved);
    if (prepared) {
      this.toast.show('Versione aggiornata');
    } else {
      this.toast.show('Questa versione non ha contenuto disponibile. Provane un\'altra.');
    }
    return prepared;
  }

  private async applyResolvedTitleAndPrepare(
    tmdbId: number,
    type: MediaType,
    resolved: ProviderPlaybackTitle
  ): Promise<boolean> {
    this.playbackTitle = resolved;
    if (type === 'tv') {
      const season = this.selectedSeason();
      const episode = this.selectedEpisode();
      const resolveSeq = this.beginPlaybackResolve();
      const prepared = await this.setEpisodeUrl(resolved, season, episode, resolveSeq);
      if (!prepared) return false;
      const seq = ++this.urlSeq;
      await this.applyResumeProgress(seq, tmdbId, 'tv', season, episode);
      return true;
    }

    const resolveSeq = this.beginPlaybackResolve();
    const prepared = await this.setMovieUrl(resolved, resolveSeq);
    if (!prepared) return false;
    const seq = ++this.urlSeq;
    await this.applyResumeProgress(seq, tmdbId, 'movie');
    return true;
  }

  // Wraps applyResolvedTitleAndPrepare with a rollback for the case where
  // a newly-confirmed provider title turns out to be unplayable (e.g., the
  // catalog lists it but the season/movie payload is missing). Without the
  // rollback the page jumps to "Riproduzione temporaneamente non
  // disponibile" right after a user-initiated pick, even though the picker
  // is still open and they can immediately try a different candidate.
  // Server-driven signals (candidates, matchStatus, resolvedTitleId) are
  // NOT reverted — they reflect persisted DB state which the caller owns.
  private async tryApplyResolvedTitle(
    tmdbId: number,
    type: MediaType,
    resolved: ProviderPlaybackTitle
  ): Promise<boolean> {
    const prev = {
      availability: this.playbackAvailability(),
      message: this.playbackUnavailableMessage(),
      reason: this.playbackUnavailableReason(),
      title: this.playbackTitle,
      pendingVideoUrl: this.pendingVideoUrl
    };

    const prepared = await this.applyResolvedTitleAndPrepare(tmdbId, type, resolved);
    if (prepared) return true;

    this.playbackAvailability.set(prev.availability);
    this.playbackUnavailableMessage.set(prev.message);
    this.playbackUnavailableReason.set(prev.reason);
    this.playbackTitle = prev.title;
    this.pendingVideoUrl = prev.pendingVideoUrl;
    return false;
  }

  private requirePlaybackTitle(): ProviderPlaybackTitle | null {
    if (this.playbackTitle) return this.playbackTitle;
    return null;
  }

  private resetPlayer(): void {
    if (this.progressSaveInterval !== null) {
      clearInterval(this.progressSaveInterval);
      this.progressSaveInterval = null;
    }
    this.iframeSrc.set('');
    this.videoStartTime = null;
    this.currentVideoTime = 0;
    this.currentVideoDuration = 0;
    this.lastSavedTime = 0;
    this.handledCompletionPlaybackId = 0;
  }

  private saveCurrentEpisodeProgress(): void {
    if (this.videoStartTime === null) return;
    if (this.currentVideoTime > 10) {
      void this.persistProgress(this.currentVideoTime, this.currentVideoDuration, this.playingSeason, this.playingEpisode);
    }
  }

  private async persistProgress(position: number, duration: number, season: number, episode: number): Promise<void> {
    const item = this.currentItem();
    const type = this.currentItemType();
    if (!this.auth.currentUser() || !item || !type) return;

    // Keep the currently-focused progress state in sync locally before the
    // network round-trip so the watch page reflects saves immediately for
    // movies and for the currently selected TV episode.
    if (type === 'movie') {
      this.resumeProgress.set({ position, duration });
      this.resumeText.set(position > 10 ? `Riprendi da ${formatTime(position)}` : '');
    } else if (season === this.selectedSeason() && episode === this.selectedEpisode()) {
      this.resumeProgress.set({ position, duration });
      this.resumeText.set(position > 10 ? `Riprendi da ${formatTime(position)}` : '');
    }

    // Update the local seriesProgress map *before* the network round-trip
    // so progress bars on episode cards animate as the user watches, not
    // only after the next page-load. The map is read by the watch page.
    if (type === 'tv' && position > 5) {
      this.seriesProgress.update(prev => {
        const next = new Map(prev);
        next.set(progressKey(season, episode), { position, duration });
        return next;
      });
    }

    await this.progress.save({
      tmdb_id: item.id,
      media_type: type,
      season: type === 'tv' ? season : 0,
      episode: type === 'tv' ? episode : 0,
      position,
      duration,
      title: item.title ?? item.name ?? null,
      poster: item.poster_path ?? null,
      backdrop: item.backdrop_path ?? null
    });
    if (position > 10) {
      await this.saveCurrentHistory(type === 'tv' ? season : 0, type === 'tv' ? episode : 0);
    }
    this.progressTick.update(n => n + 1);

    // If the periodic 15s save just crossed CONTINUE_HIDE_THRESHOLD on
    // the episode the CTA points to, advance the CTA on the fly.
    // Previously it updated only on the 'ended' event, so pausing at 96%
    // left the button stuck on "Riprendi da S2 E2" until reload.
    if (type === 'tv' && duration > 0 && position >= duration * CONTINUE_HIDE_THRESHOLD) {
      const cur = untracked(() => this.nextUnwatchedRef());
      if (cur && cur.season === season && cur.episode === episode) {
        void this.refreshNextUnwatchedRef();
      }
    }
  }

  // Re-fetch the next-unwatched coordinate from the backend after an
  // episode actually completes. Cheap (one row) but only fires on 'ended',
  // not on every 10s tick — the CTA target only needs to advance when the
  // user *finishes* something.
  private async refreshNextUnwatchedRef(): Promise<void> {
    const item = this.currentItem();
    if (!item || this.currentItemType() !== 'tv') return;
    const next = await this.progress.getNextUnwatched(item.id, 'tv');
    this.nextUnwatchedRef.set(next);
  }

  private async saveCurrentHistory(season: number, episode: number): Promise<void> {
    const item = this.currentItem();
    const type = this.currentItemType();
    if (!this.auth.currentUser() || !item || !type) return;
    await this.history.save(
      item.id, type,
      type === 'tv' ? season : 0,
      type === 'tv' ? episode : 0,
      item.title ?? item.name ?? '',
      item.poster_path ?? null
    );
  }

  private handlePlayerMessage(event: MessageEvent): void {
    const data = event.data;
    if (!data || typeof data !== 'object' || (data as { type?: unknown }).type !== 'PLAYER_EVENT') return;
    this.applyPlayerEvent((data as PlayerEventMessage).event);
  }

  private applyPlayerEvent(ev: PlayerEventMessage['event']): void {
    const evtName = ev.event;
    const ct = ev.currentTime;
    const dur = ev.duration;

    if (typeof ct === 'number' && ct >= 0) this.currentVideoTime = ct;
    if (typeof dur === 'number' && dur > 0) this.currentVideoDuration = dur;

    if (evtName === 'play' || evtName === 'playing') {
      if (this.videoStartTime === null) this.videoStartTime = Date.now();
    } else if (evtName === 'pause') {
      if (this.currentVideoTime > 10) {
        void this.persistProgress(this.currentVideoTime, this.currentVideoDuration, this.playingSeason, this.playingEpisode);
        this.lastSavedTime = this.currentVideoTime;
      }
    } else if (evtName === 'ended' || evtName === 'complete') {
      if (this.playbackInstanceId !== 0 && this.handledCompletionPlaybackId === this.playbackInstanceId) {
        return;
      }
      this.handledCompletionPlaybackId = this.playbackInstanceId;
      if (this.currentVideoDuration > 0) {
        void this.persistProgress(this.currentVideoDuration, this.currentVideoDuration, this.playingSeason, this.playingEpisode);
      }
      void this.refreshNextUnwatchedRef();
      void this.maybeAutoPlayNext();
    }
  }

  private async maybeAutoPlayNext(): Promise<void> {
    const user = this.auth.currentUser();
    if (!user || !user.autoplay_next) return;
    if (this.currentItemType() !== 'tv') return;

    const item = this.currentItem();
    if (!item) return;
    const playback = this.requirePlaybackTitle();
    if (!playback) return;

    const eps = this.episodes();
    const currentEp = this.selectedEpisode();
    const nextEp = eps.find(e => e.episode_number > currentEp);
    if (nextEp !== undefined) {
      const season = this.selectedSeason();
      const resolveSeq = this.beginPlaybackResolve();
      const nextResult = await this.resolveEpisodeEmbedUrl(playback, season, nextEp.episode_number);
      if (!this.isCurrentPlaybackResolve(resolveSeq)) return;
      if (!nextResult.embedUrl) {
        this.setPlaybackUnavailable(nextResult.reason);
        return;
      }

      this.selectedEpisode.set(nextEp.episode_number);
      this.activeEpisodeRef.set({ season, episode: nextEp.episode_number });
      this.resetPlayer();
      const prepared = this.commitResolvedPlaybackUrl(nextResult.embedUrl, resolveSeq);
      if (!prepared) return;
      const seq = ++this.urlSeq;
      await this.applyResumeProgress(seq, item.id, 'tv', season, nextEp.episode_number);
      this.startVideo();
      return;
    }

    const seasons = this.seasons();
    const currentSeason = this.selectedSeason();
    const nextSeason = seasons.find(s => s > currentSeason);
    if (nextSeason !== undefined) {
      const started = await this.playNextEpisode();
      if (!started) return;
    }
  }
}

// Returns the episodes from a TMDB season-details payload that have already
// aired.
//
// DECISION: prefer the show-level `last_episode_to_air` / `next_episode_to_air`
// as the boundary (via getEffectiveLastEpisode upstream). Those fields are
// curated by TMDB and consistently correct, whereas per-episode `air_date`
// values are sometimes wrong (placeholders, premiere date copied across
// episodes, …) — trusting them alone leaked future episodes into the grid for
// in-progress shows (e.g. S1E7/E8 showing up while only E6 had aired).
//
// Falls back to a per-episode `air_date` filter only when the show-level
// reference is unavailable (e.g. shows that haven't started yet).
function airedEpisodes(
  eps: TmdbEpisodeDetail[] | undefined,
  season: number,
  effectiveLast: { season_number?: number; episode_number?: number } | null
): TmdbEpisodeDetail[] {
  if (!eps?.length) return [];
  const sorted = eps.slice().sort((a, b) => a.episode_number - b.episode_number);

  const lastS = effectiveLast?.season_number;
  const lastE = effectiveLast?.episode_number;
  if (lastS !== undefined && lastE !== undefined) {
    if (season < lastS) return sorted;          // past season → all aired
    if (season > lastS) return [];              // future season → none
    return sorted.filter(e => e.episode_number <= lastE); // current season → cap
  }

  // Fallback: no show-level boundary. End-of-day cutoff so today's episodes
  // show immediately. Episodes WITHOUT a confirmed air_date are excluded.
  const cutoff = new Date();
  cutoff.setHours(23, 59, 59, 999);
  return sorted.filter(e => {
    if (!e.air_date) return false;
    const d = new Date(e.air_date);
    return !Number.isNaN(d.getTime()) && d <= cutoff;
  });
}

function availableSeasons(item: TmdbItem): Array<NonNullable<TmdbItem['seasons']>[number]> {
  const seasons = (item.seasons ?? []).filter((season) => season.season_number > 0);
  const lastAiredSeason = getEffectiveLastEpisode(item)?.season_number;
  if (lastAiredSeason !== undefined) {
    return seasons.filter((season) => season.season_number <= lastAiredSeason);
  }

  // Fallback: no last/next_episode_to_air available. Mirrors the airedEpisodes()
  // decision — seasons WITHOUT a confirmed air_date are excluded so future
  // seasons that TMDB lists with air_date: null don't leak into the selector.
  const cutoff = new Date();
  cutoff.setHours(23, 59, 59, 999);
  return seasons.filter((season) => {
    if (!season.air_date) return false;
    const date = new Date(season.air_date);
    return !Number.isNaN(date.getTime()) && date <= cutoff;
  });
}

// Stub episode list for when the season-details fetch fails — keeps the
// dropdown / card grid populated with bare numbered placeholders so the user
// can still pick an episode (the player will then load whatever vixcloud has).
function episodeStubs(count: number): TmdbEpisodeDetail[] {
  return Array.from({ length: count }, (_, i) => ({ episode_number: i + 1 }));
}
