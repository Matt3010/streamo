import { Injectable, signal, computed, inject, untracked } from '@angular/core';
import { TmdbService } from './tmdb.service';
import { ProgressService } from './progress.service';
import { WatchlistService } from './watchlist.service';
import { HistoryService } from './history.service';
import { AuthService } from './auth.service';
import { ToastService } from './toast.service';
import type { MediaType, TmdbItem, TmdbEpisodeDetail, PlayerEventMessage } from '../models';

const VIXSRC_BASE = '/player';
const BACKDROP_BASE = 'https://image.tmdb.org/t/p/w1280';

@Injectable({ providedIn: 'root' })
export class PlayerService {
  private tmdb = inject(TmdbService);
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
  private urlSeq = 0;
  readonly iframeSrc = signal('');

  // Playback tracking
  readonly resumeText = signal('');
  // Saved progress for the *current* selected episode. Drives the
  // "Riprendi da hh:mm:ss" button label and the "Vai al prossimo" decision
  // (shown only if pct >= 80% — same WATCHED_THRESHOLD as the backend).
  readonly resumeProgress = signal<{ position: number; duration: number } | null>(null);
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
    const last = item?.last_episode_to_air;
    const future = seasons
      .filter(s => s.season_number > cs && (s.episode_count ?? 0) > 0)
      // If we know the latest aired episode, only consider seasons up to it.
      .filter(s => !last || s.season_number <= (last.season_number ?? Infinity))
      .sort((a, b) => a.season_number - b.season_number)[0];
    return future ? { season: future.season_number, episode: 1 } : null;
  });
  readonly isInWatchlist = signal(false);
  private currentVideoTime = 0;
  private currentVideoDuration = 0;
  private lastSavedTime = 0;
  private videoStartTime: number | null = null;
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
    this.seasons.set([]);
    this.episodes.set([]);

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
    this.backdropUrl.set(backdrop ? `${BACKDROP_BASE}${backdrop}` : '');

    this.iframeSrc.set('');
    this.videoStartTime = null;
    this.currentVideoTime = 0;
    this.currentVideoDuration = 0;
    this.lastSavedTime = 0;
    this.resumeText.set('');

    // Watchlist status (fire and forget)
    void this.refreshWatchlistStatus(tmdbId, type);

    if (type === 'tv') {
      // No explicit s/e from the URL → ask the backend for the next unwatched
      // episode based on the user's progress. Lets a card click on the home
      // row "La mia lista" or on the watchlist page resume where they left.
      if (resumeSeason === 0 && resumeEpisode === 0) {
        const next = await this.progress.getNextUnwatched(tmdbId, 'tv');
        if (next) {
          resumeSeason = next.season;
          resumeEpisode = next.episode;
        }
      }
      await this.setupTVPlayer(tmdbId, item, resumeSeason, resumeEpisode);
    } else {
      this.seasons.set([]);
      this.episodes.set([]);
      this.pendingVideoUrl = `${VIXSRC_BASE}/movie/${tmdbId}`;
      const seq = ++this.urlSeq;
      await this.applyResumeProgress(seq, tmdbId, 'movie');
    }
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
    this.progressTick.update(n => n + 1);
  }

  // ===== START / EPISODE =====
  startVideo(): void {
    if (!this.pendingVideoUrl) return;
    this.iframeSrc.set(this.pendingVideoUrl);
    this.videoStartTime = Date.now();
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

    void this.saveCurrentHistory();

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
    this.saveCurrentEpisodeProgress();

    this.selectedSeason.set(season);
    const seasonData = await this.tmdb.getSeasonDetails(item.id, season);
    const aired = airedEpisodes(seasonData?.episodes);
    const fallbackCount = (item.seasons ?? []).find(s => s.season_number === season)?.episode_count ?? 10;
    this.episodes.set(aired.length ? aired : episodeStubs(fallbackCount));
    this.selectedEpisode.set(1);

    this.resetPlayer();
    this.setEpisodeUrl(item.id, season, 1);
    const seq = ++this.urlSeq;
    await this.applyResumeProgress(seq, item.id, 'tv', season, 1);
  }

  async changeEpisode(episode: number): Promise<void> {
    const item = this.currentItem();
    if (!item) return;
    this.saveCurrentEpisodeProgress();

    this.selectedEpisode.set(episode);
    const season = this.selectedSeason();
    this.resetPlayer();
    this.setEpisodeUrl(item.id, season, episode);
    const seq = ++this.urlSeq;
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

    try {
      if (this.isInWatchlist()) {
        await this.watchlist.remove(item.id, type);
        this.isInWatchlist.set(false);
        this.toast.show('Rimosso dalla lista');
      } else {
        await this.watchlist.add(item.id, type, title, poster);
        this.isInWatchlist.set(true);
        this.toast.show('Aggiunto alla lista');
      }
    } catch {
      this.toast.show('Errore');
    }
  }

  // ===== PRIVATE =====
  private async setupTVPlayer(tmdbId: string | number, item: TmdbItem, resumeSeason: number, resumeEpisode: number): Promise<void> {
    const seasonsList = (item.seasons ?? []).filter(s => s.season_number > 0);
    const seasonNumbers = seasonsList.length ? seasonsList.map(s => s.season_number) : [1];
    this.seasons.set(seasonNumbers);

    const targetSeason = resumeSeason > 0 ? resumeSeason : (seasonNumbers[0] ?? 1);
    this.selectedSeason.set(targetSeason);

    const seasonData = await this.tmdb.getSeasonDetails(Number(tmdbId), targetSeason);
    const aired = airedEpisodes(seasonData?.episodes);
    const fallback = seasonsList.find(s => s.season_number === targetSeason)?.episode_count ?? 10;
    this.episodes.set(aired.length ? aired : episodeStubs(fallback));

    const targetEpisode = resumeEpisode > 0 ? resumeEpisode : 1;
    this.selectedEpisode.set(targetEpisode);

    this.setEpisodeUrl(tmdbId, targetSeason, targetEpisode);
    const seq = ++this.urlSeq;
    await this.applyResumeProgress(seq, tmdbId, 'tv', targetSeason, targetEpisode);
  }

  private setEpisodeUrl(tmdbId: string | number, season: number, episode: number): void {
    this.pendingVideoUrl = `${VIXSRC_BASE}/tv/${tmdbId}/${season}/${episode}`;
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
      const startTime = Math.floor(progress.position);
      const sep = this.pendingVideoUrl.includes('?') ? '&' : '?';
      this.pendingVideoUrl += `${sep}start=${startTime}`;
    } else {
      this.resumeProgress.set(null);
      this.resumeText.set('');
    }
  }

  // Switch the player to the next episode and start it from the beginning.
  // Used by the preview "Vai al prossimo" button to skip past the tail-end
  // of the current episode (≥80%) instead of resuming it.
  async playNextEpisode(): Promise<void> {
    const next = untracked(() => this.nextEpisode());
    const item = untracked(() => this.currentItem());
    if (!next || !item) return;

    this.saveCurrentEpisodeProgress();

    const seasonChanged = next.season !== this.selectedSeason();
    this.selectedSeason.set(next.season);
    this.selectedEpisode.set(next.episode);

    if (seasonChanged) {
      const seasonData = await this.tmdb.getSeasonDetails(item.id, next.season);
      const aired = airedEpisodes(seasonData?.episodes);
      const fallback = (item.seasons ?? []).find(s => s.season_number === next.season)?.episode_count ?? 10;
      this.episodes.set(aired.length ? aired : episodeStubs(fallback));
    }

    this.resetPlayer();
    this.setEpisodeUrl(item.id, next.season, next.episode);
    // No applyResumeProgress — we want a clean start, not a seek to a
    // half-watched checkpoint of an episode the user explicitly skipped.
    this.urlSeq++;
    this.resumeText.set('');
    this.resumeProgress.set(null);
    this.startVideo();
  }

  private async refreshWatchlistStatus(tmdbId: string | number, type: MediaType): Promise<void> {
    // Don't gate on `auth.currentUser()` here — on hard refresh the signal
    // is null until AuthService.checkAuth() resolves, but the cookie is on
    // the request, so watchlist.check() returns the real flag. Gating dropped
    // the bookmark "active" state intermittently on /watch reloads.
    this.isInWatchlist.set(await this.watchlist.check(tmdbId, type));
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
    this.progressTick.update(n => n + 1);
  }

  private async saveCurrentHistory(): Promise<void> {
    const item = this.currentItem();
    const type = this.currentItemType();
    if (!this.auth.currentUser() || !item || !type) return;
    await this.history.save(
      item.id, type,
      type === 'tv' ? this.playingSeason : 0,
      type === 'tv' ? this.playingEpisode : 0,
      item.title ?? item.name ?? '',
      item.poster_path ?? null
    );
  }

  private handlePlayerMessage(event: MessageEvent): void {
    const data = event.data;
    if (!data || typeof data !== 'object' || (data as { type?: unknown }).type !== 'PLAYER_EVENT') return;

    const ev = (data as PlayerEventMessage).event;
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
      if (this.currentVideoDuration > 0) {
        void this.persistProgress(this.currentVideoDuration, this.currentVideoDuration, this.playingSeason, this.playingEpisode);
      }
      void this.maybeAutoPlayNext();
    }
  }

  private async maybeAutoPlayNext(): Promise<void> {
    const user = this.auth.currentUser();
    if (!user || !user.autoplay_next) return;
    if (this.currentItemType() !== 'tv') return;

    const item = this.currentItem();
    if (!item) return;

    const eps = this.episodes();
    const currentEp = this.selectedEpisode();
    const nextEp = eps.find(e => e.episode_number > currentEp);
    if (nextEp !== undefined) {
      this.selectedEpisode.set(nextEp.episode_number);
      const season = this.selectedSeason();
      this.resetPlayer();
      this.setEpisodeUrl(item.id, season, nextEp.episode_number);
      const seq = ++this.urlSeq;
      await this.applyResumeProgress(seq, item.id, 'tv', season, nextEp.episode_number);
      this.startVideo();
      return;
    }

    const seasons = this.seasons();
    const currentSeason = this.selectedSeason();
    const nextSeason = seasons.find(s => s > currentSeason);
    if (nextSeason !== undefined) {
      await this.changeSeason(nextSeason);
      this.startVideo();
    }
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

// Returns the episodes from a TMDB season-details payload that have already
// aired (no air_date treated as aired so episodes without a confirmed date
// still surface). End-of-day cutoff so today's episodes show immediately.
function airedEpisodes(eps: TmdbEpisodeDetail[] | undefined): TmdbEpisodeDetail[] {
  if (!eps?.length) return [];
  const cutoff = new Date();
  cutoff.setHours(23, 59, 59, 999);
  return eps
    .filter(e => {
      if (!e.air_date) return true;
      const d = new Date(e.air_date);
      return !Number.isNaN(d.getTime()) && d <= cutoff;
    })
    .slice()
    .sort((a, b) => a.episode_number - b.episode_number);
}

// Stub episode list for when the season-details fetch fails — keeps the
// dropdown / card grid populated with bare numbered placeholders so the user
// can still pick an episode (the player will then load whatever vixsrc has).
function episodeStubs(count: number): TmdbEpisodeDetail[] {
  return Array.from({ length: count }, (_, i) => ({ episode_number: i + 1 }));
}
