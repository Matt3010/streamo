// Singleton store backing the Player screen. Mirrors PlayerViewModel.kt:
// owns the hls.js instance + <video>, drives resume / progress save / source
// fallback / next-prev, and exposes signals the ControlsOverlay + SettingsOverlay
// read. The screen creates the <video> element and calls attach(); everything
// else (hls lifecycle, tracks, seek) lives here.
import { signal, type Signal } from '@preact/signals';
import Hls from 'hls.js';
import { movieSource, episodeSource, animeSource } from '../data/provider/ProviderResolver';
import type { PlaybackSource } from '../data/provider/models';
import { TMDBClient } from '../data/tmdb/TMDBClient';
import { displayTitle, primaryDate } from '../data/tmdb/dto';
import { toTvItem } from '../util/tmdbToTvlogic';
import { nextEpisode, previousEpisode, WATCHED_THRESHOLD } from '../util/tvlogic';
import { repo } from '../data/repositories';
import { settings } from '../data/settings';
import type { PlayerRoute, MediaType } from '../router/routes';

type PlayerState = 'idle' | 'loading' | 'ready' | 'error';

export interface TrackOption {
  id: number;
  label: string;
}

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export const PlayerStore = {
  state: signal<PlayerState>('idle') as Signal<PlayerState>,
  errorMessage: signal<string | null>(null) as Signal<string | null>,
  paused: signal(true) as Signal<boolean>,
  buffering: signal(false) as Signal<boolean>,
  ended: signal(false) as Signal<boolean>,
  positionSec: signal(0) as Signal<number>,
  durationSec: signal(0) as Signal<number>,
  bufferedSec: signal(0) as Signal<number>,
  pendingSeekMs: signal(-1) as Signal<number>,
  scrubbing: signal(false) as Signal<boolean>,
  /** Position at the start of the current scrub run (-1 = none); the ±N skip
   *  indicator shows pendingSeekMs - scrubAnchorMs (mirrors scrubStartPositionMs). */
  scrubAnchorMs: signal(-1) as Signal<number>,
  seekbarFocused: signal(false) as Signal<boolean>,
  controlsVisible: signal(false) as Signal<boolean>,
  settingsOpen: signal(false) as Signal<boolean>,

  title: signal('') as Signal<string>,
  subtitle: signal('') as Signal<string>,
  poster: signal<string | undefined>(undefined) as Signal<string | undefined>,
  warpActive: signal(false) as Signal<boolean>,

  sources: signal<PlaybackSource[]>([]) as Signal<PlaybackSource[]>,
  sourceIdx: signal(0) as Signal<number>,
  sourceLabels: signal<string[]>([]) as Signal<string[]>,

  subtitleTracks: signal<TrackOption[]>([]) as Signal<TrackOption[]>,
  subtitleIdx: signal(-1) as Signal<number>, // -1 = off
  audioTracks: signal<TrackOption[]>([]) as Signal<TrackOption[]>,
  audioIdx: signal(-1) as Signal<number>,
  speed: signal(1) as Signal<number>,
  quality: signal('auto') as Signal<string>, // 'auto' | '720' | '1080'
  aspect: signal('contain') as Signal<string>, // 'contain' | 'cover' | 'zoom'

  hasNext: signal(false) as Signal<boolean>,
  hasPrev: signal(false) as Signal<boolean>,

  // internal (not signals)
  hls: null as Hls | null,
  video: null as HTMLVideoElement | null,
  route: null as PlayerRoute | null,
  /** Set by PlayerScreen to navigate on next/prev episode. */
  onNavNext: null as ((r: PlayerRoute) => void) | null,
  lastSaveTs: 0,
  _autoHideHandle: null as number | null,
  /** One in-place hls recovery already attempted for the current source. */
  _recovered: false,
  /** Invalidates async work when the route changes or the player unmounts. */
  _loadGeneration: 0,
  /** Invalidates manifest callbacks when switching/falling back between sources. */
  _sourceGeneration: 0,
  /** False while the video element still contains media from a previous route. */
  _progressEnabled: false,

  SPEEDS,

  AUTO_HIDE_MS: 4000,

  /** Show controls and (re)start the 4s auto-hide timer if playing. */
  showControls(): void {
    PlayerStore.controlsVisible.value = true;
    PlayerStore.scheduleAutoHide();
  },

  hideControls(): void {
    if (PlayerStore.settingsOpen.value) return; // never hide behind the settings panel
    PlayerStore.controlsVisible.value = false;
    if (PlayerStore._autoHideHandle != null) {
      clearTimeout(PlayerStore._autoHideHandle);
      PlayerStore._autoHideHandle = null;
    }
  },

  /** Reset the auto-hide timer (call on any input while controls are up). */
  scheduleAutoHide(): void {
    if (PlayerStore._autoHideHandle != null) clearTimeout(PlayerStore._autoHideHandle);
    // ponytail: keep controls pinned while paused, buffering, ended or settings
    // open — auto-hide only runs during active playback (Android auto-hide gate).
    if (
      PlayerStore.paused.value ||
      PlayerStore.buffering.value ||
      PlayerStore.settingsOpen.value ||
      PlayerStore.ended.value
    ) {
      PlayerStore._autoHideHandle = null;
      return;
    }
    PlayerStore._autoHideHandle = window.setTimeout(() => {
      PlayerStore.controlsVisible.value = false;
      PlayerStore._autoHideHandle = null;
    }, PlayerStore.AUTO_HIDE_MS);
  },

  /** Bind the store to a <video> element and create the hls.js instance. */
  attach(video: HTMLVideoElement): void {
    PlayerStore.video = video;
    if (Hls.isSupported()) {
      const hls = new Hls({
        capLevelToPlayerSize: true,
        maxBufferLength: 30,
        startLevel: -1
      });
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        PlayerStore.applyQuality();
        PlayerStore.refreshTracks();
      });
      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, PlayerStore.refreshTracks);
      hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, PlayerStore.refreshTracks);
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) PlayerStore.handleFatal(data.type);
      });
      PlayerStore.hls = hls;
    }
    // ponytail: native-HLS fallback (Safari / some VIDAA models). If hls.js
    // isn't supported, the proxy still owns headers so video.src works.
  },

  detach(): void {
    PlayerStore._loadGeneration++;
    PlayerStore._sourceGeneration++;
    PlayerStore.saveProgressFinal();
    PlayerStore._progressEnabled = false;
    if (PlayerStore._autoHideHandle != null) {
      clearTimeout(PlayerStore._autoHideHandle);
      PlayerStore._autoHideHandle = null;
    }
    if (PlayerStore.hls) {
      PlayerStore.hls.destroy();
      PlayerStore.hls = null;
    }
    PlayerStore.video = null;
    PlayerStore.route = null;
    PlayerStore.state.value = 'idle';
  },

  /** Load a title: resolve sources, fetch the tmdb item for next/prev, resume. */
  async load(route: PlayerRoute): Promise<void> {
    const generation = ++PlayerStore._loadGeneration;
    PlayerStore._sourceGeneration++;

    // Persist the old coordinate before changing route, then stop it. Provider
    // resolution can take seconds; allowing the old video to keep emitting
    // timeupdate in that window would save its position under the new episode.
    PlayerStore.saveProgressFinal();
    PlayerStore._progressEnabled = false;
    PlayerStore.lastSaveTs = 0;
    PlayerStore.video?.pause();
    PlayerStore.hls?.stopLoad();

    // The PlayerScreen instance is reused for next/previous episodes. Clear
    // both the UI timeline and the media element immediately, otherwise they
    // keep showing the previous episode's position while the new provider
    // source is being resolved. startSource() will apply this episode's saved
    // resume position once its manifest/metadata is ready.
    PlayerStore.positionSec.value = 0;
    PlayerStore.durationSec.value = 0;
    PlayerStore.bufferedSec.value = 0;
    const video = PlayerStore.video;
    if (video) {
      try {
        video.currentTime = 0;
      } catch {
        // A media element without metadata may reject seeking; resetting the
        // signals is still enough until the new source becomes ready.
      }
    }

    PlayerStore.route = route;
    PlayerStore.state.value = 'loading';
    PlayerStore.errorMessage.value = null;
    PlayerStore.ended.value = false;
    PlayerStore.pendingSeekMs.value = -1;
    PlayerStore.scrubbing.value = false;
    PlayerStore.scrubAnchorMs.value = -1;
    PlayerStore.sources.value = [];
    PlayerStore.sourceLabels.value = [];
    PlayerStore.title.value = route.title?.trim() ?? '';
    PlayerStore.poster.value = route.poster;
    PlayerStore.warpActive.value = settings.warpEnabled.value;

    // Paths intentionally contain only stable identifiers. On a direct URL,
    // refresh, or history entry created before route state existed, reconstruct
    // the provider inputs from TMDB before resolving the stream.
    let effectiveRoute = { ...route };
    const missingTitle = !effectiveRoute.title?.trim();
    const needsMetadata =
      (route.mediaType === 'movie' || route.mediaType === 'tv') &&
      (missingTitle || !route.releaseDate || !route.poster);
    if (needsMetadata) {
      try {
        const item = await TMDBClient.details(route.tmdbId, route.mediaType);
        if (generation !== PlayerStore._loadGeneration) return;
        effectiveRoute = {
          ...effectiveRoute,
          title: effectiveRoute.title?.trim() || displayTitle(item),
          releaseDate: effectiveRoute.releaseDate || primaryDate(item) || undefined,
          poster: effectiveRoute.poster || item.poster_path || undefined
        };
        PlayerStore.route = effectiveRoute;
        PlayerStore.title.value = effectiveRoute.title ?? '';
        PlayerStore.poster.value = effectiveRoute.poster;
        // Preserve the hydrated fields for reload/back-forward without changing
        // the canonical URL.
        try {
          window.history.replaceState(effectiveRoute, '', window.location.href);
        } catch {
          // Older VIDAA engines may reject History state; the in-memory route is
          // still sufficient for this playback session.
        }
      } catch (e) {
        if (generation !== PlayerStore._loadGeneration) return;
        if (missingTitle) {
          PlayerStore.fail(e instanceof Error ? e.message : 'Metadati TMDB non disponibili');
          return;
        }
        // Title is enough for provider resolution; poster/date enrichment is
        // best-effort when navigation already supplied the title.
      }
    }

    if (!effectiveRoute.title?.trim()) {
      PlayerStore.fail('Titolo non disponibile');
      return;
    }

    // Resolve playable sources (re-resolve; ProviderResolver caches).
    let sources: PlaybackSource[] = [];
    try {
      const res =
        effectiveRoute.mediaType === 'movie'
          ? await movieSource(
              effectiveRoute.tmdbId,
              effectiveRoute.title,
              effectiveRoute.releaseDate ?? null
            )
          : effectiveRoute.mediaType === 'anime'
            ? await animeSource(effectiveRoute.tmdbId, effectiveRoute.animeSlug ?? null, Number(effectiveRoute.animeEpisodeId))
            : await episodeSource(
              effectiveRoute.tmdbId,
              effectiveRoute.title,
              effectiveRoute.releaseDate ?? null,
              effectiveRoute.resumeSeason ?? 1,
              effectiveRoute.resumeEpisode ?? 1
            );
      if (generation !== PlayerStore._loadGeneration) return;
      sources = res.sources;
      if (!sources.length) {
        PlayerStore.fail(res.message ?? 'Titolo non disponibile');
        return;
      }
    } catch (e) {
      if (generation !== PlayerStore._loadGeneration) return;
      PlayerStore.fail(e instanceof Error ? e.message : 'Errore di risoluzione');
      return;
    }

    PlayerStore.sources.value = sources;
    PlayerStore.sourceLabels.value = sources.map((_, i) =>
      sources.length > 1 ? `Server ${i + 1}` : 'Server'
    );
    PlayerStore.sourceIdx.value = 0;

    // Episode subtitle + next/prev for tv.
    if (effectiveRoute.mediaType === 'tv') {
      PlayerStore.subtitle.value = `S${effectiveRoute.resumeSeason ?? 1} E${effectiveRoute.resumeEpisode ?? 1}`;
      void PlayerStore.loadEpisodeMeta(effectiveRoute, generation);
    } else {
      PlayerStore.subtitle.value = effectiveRoute.mediaType === 'anime' ? `Episodio ${effectiveRoute.resumeEpisode ?? ''}` : '';
      PlayerStore.hasNext.value = false;
      PlayerStore.hasPrev.value = false;
    }

    // Resume position from saved progress.
    const season = effectiveRoute.mediaType === 'movie' ? 0 : effectiveRoute.resumeSeason ?? 1;
    const episode = effectiveRoute.mediaType === 'movie' ? 0 : effectiveRoute.resumeEpisode ?? 1;
    let startSec = 0;
    try {
      const p = await repo.getProgressByCoordinate(
        effectiveRoute.tmdbId,
        effectiveRoute.mediaType,
        season,
        episode
      );
      if (generation !== PlayerStore._loadGeneration) return;
      if (p && p.positionSeconds > 10 && (p.durationSeconds <= 0 || p.positionSeconds < p.durationSeconds * WATCHED_THRESHOLD)) {
        startSec = p.positionSeconds;
      }
    } catch {
      // best-effort
    }

    if (generation === PlayerStore._loadGeneration) PlayerStore.startSource(0, startSec);
  },

  /** Load a source by index at a given start position (seconds). */
  startSource(idx: number, startSec: number): void {
    const url = PlayerStore.sources.value[idx]?.playlistUrl;
    const video = PlayerStore.video;
    const hls = PlayerStore.hls;
    if (!url || !video) return;
    const loadGeneration = PlayerStore._loadGeneration;
    const sourceGeneration = ++PlayerStore._sourceGeneration;
    PlayerStore._progressEnabled = false;
    PlayerStore.sourceIdx.value = idx;
    PlayerStore.state.value = 'loading';
    PlayerStore._recovered = false;
    video.pause();
    if (hls) {
      hls.loadSource(url);
      hls.once(Hls.Events.MANIFEST_PARSED, () => {
        if (
          loadGeneration !== PlayerStore._loadGeneration ||
          sourceGeneration !== PlayerStore._sourceGeneration ||
          hls !== PlayerStore.hls
        ) return;
        hls.startLoad(startSec);
        video.currentTime = startSec;
        PlayerStore._progressEnabled = true;
        PlayerStore.state.value = 'ready';
        PlayerStore.playSourceWhenReady(video, loadGeneration, sourceGeneration);
      });
    } else {
      // native HLS fallback
      video.src = url;
      video.addEventListener(
        'loadedmetadata',
        () => {
          if (
            loadGeneration !== PlayerStore._loadGeneration ||
            sourceGeneration !== PlayerStore._sourceGeneration ||
            video !== PlayerStore.video
          ) return;
          video.currentTime = startSec;
          PlayerStore._progressEnabled = true;
          PlayerStore.state.value = 'ready';
          PlayerStore.playSourceWhenReady(video, loadGeneration, sourceGeneration);
        },
        { once: true }
      );
    }
  },

  /**
   * Start a newly selected stream as soon as the video is actually playable.
   * MANIFEST_PARSED/loadedmetadata are not sufficient on several VIDAA media
   * engines: calling play() there can be silently ignored. Retrying on media
   * readiness also covers reloads and next/previous episode navigation.
   */
  playSourceWhenReady(
    video: HTMLVideoElement,
    loadGeneration: number,
    sourceGeneration: number
  ): void {
    const isCurrentSource = () =>
      loadGeneration === PlayerStore._loadGeneration &&
      sourceGeneration === PlayerStore._sourceGeneration &&
      video === PlayerStore.video;
    const play = () => {
      if (!isCurrentSource()) return;
      video.autoplay = true;
      void video.play().catch(() => {
        // The canplay/loadeddata handlers below retry once the decoder has
        // enough data. A user-gesture policy rejection remains non-fatal.
      });
    };

    // Register before the first attempt: some implementations reject play()
    // while buffering but emit one of these events immediately afterwards.
    video.addEventListener('loadeddata', play, { once: true });
    video.addEventListener('canplay', play, { once: true });
    play();
  },

  /** Fetch the tmdb tv item + episode name for next/prev + subtitle. */
  async loadEpisodeMeta(route: PlayerRoute, generation: number): Promise<void> {
    try {
      const det = await TMDBClient.details(route.tmdbId, 'tv');
      if (generation !== PlayerStore._loadGeneration) return;
      const item = toTvItem(det);
      const s = route.resumeSeason ?? 1;
      const e = route.resumeEpisode ?? 1;
      const nx = nextEpisode(item, s, e);
      const pv = previousEpisode(item, s, e);
      PlayerStore.hasNext.value = nx !== null;
      PlayerStore.hasPrev.value = pv !== null;
      // Episode name for the subtitle (best-effort, cosmetic).
      try {
        const season = await TMDBClient.seasonDetails(route.tmdbId, s);
        if (generation !== PlayerStore._loadGeneration) return;
        const ep = (season.episodes ?? []).find((x) => x.episode_number === e);
        if (ep?.name) PlayerStore.subtitle.value = `S${s} E${e} - ${ep.name}`;
      } catch {
        // keep "S{n} E{m}"
      }
    } catch {
      // best-effort
    }
  },

  togglePlay(): void {
    const v = PlayerStore.video;
    if (!v) return;
    if (v.paused) {
      PlayerStore.ended.value = false;
      void v.play().catch(() => {});
    } else {
      v.pause();
    }
  },

  /** Apply a committed seek (seconds). */
  seekToSec(sec: number): void {
    const v = PlayerStore.video;
    if (!v) return;
    v.currentTime = sec;
  },

  /** Called by the screen when the seek has landed near the pending target. */
  clearPending(): void {
    PlayerStore.pendingSeekMs.value = -1;
  },

  setSpeed(speed: number): void {
    PlayerStore.speed.value = speed;
    if (PlayerStore.video) PlayerStore.video.playbackRate = speed;
  },

  setQuality(q: string): void {
    PlayerStore.quality.value = q;
    PlayerStore.applyQuality();
  },

  applyQuality(): void {
    const hls = PlayerStore.hls;
    if (!hls) return;
    const q = PlayerStore.quality.value;
    if (q === 'auto') {
      hls.autoLevelCapping = -1;
      hls.currentLevel = -1;
      return;
    }
    const max = Number(q);
    // Best (highest) level index within the ceiling; if every level exceeds it,
    // fall back to the lowest level (mirrors Android streaming-limit selection).
    let best = -1;
    let lowest = -1;
    hls.levels.forEach((lv, i) => {
      if (!lv.height) return;
      if (lowest === -1 || lv.height < (hls.levels[lowest].height ?? Infinity)) lowest = i;
      if (lv.height <= max && (best === -1 || (hls.levels[best].height ?? 0) < lv.height)) best = i;
    });
    // A manual choice must select a level. The old ABR cap plus currentLevel
    // = -1 only constrained automatic selection, so 720p and 1080p could
    // keep playing the exact same rendition.
    hls.autoLevelCapping = -1;
    hls.currentLevel = best >= 0 ? best : lowest;
  },

  setAspect(a: string): void {
    PlayerStore.aspect.value = a;
  },

  setSubtitle(idx: number): void {
    PlayerStore.subtitleIdx.value = idx;
    if (PlayerStore.hls) PlayerStore.hls.subtitleTrack = idx;
  },

  setAudio(idx: number): void {
    PlayerStore.audioIdx.value = idx;
    if (PlayerStore.hls) PlayerStore.hls.audioTrack = idx;
  },

  setSource(idx: number): void {
    if (idx === PlayerStore.sourceIdx.value) return;
    const v = PlayerStore.video;
    PlayerStore.saveProgressFinal();
    PlayerStore.startSource(idx, v ? v.currentTime : 0);
  },

  refreshTracks(): void {
    const hls = PlayerStore.hls;
    if (!hls) return;
    PlayerStore.subtitleTracks.value = hls.subtitleTracks.map((t) => ({ id: t.id, label: t.name || t.lang || `Sottotitolo ${t.id + 1}` }));
    PlayerStore.audioTracks.value = hls.audioTracks.map((t) => ({ id: t.id, label: t.name || t.lang || `Audio ${t.id + 1}` }));
    // Reflect what hls actually plays (manifest DEFAULT tracks auto-enable),
    // so the settings overlay shows the real selection, not a stale -1.
    PlayerStore.audioIdx.value = hls.audioTrack ?? -1;
    PlayerStore.subtitleIdx.value = hls.subtitleTrack ?? -1;
  },

  handleFatal(type: string): void {
    // One in-place recovery per source before failing over (what ExoPlayer's
    // retry gives the Android player for free): transient network hiccup →
    // resume loading; decoder glitch → recoverMediaError.
    const hls = PlayerStore.hls;
    if (hls && !PlayerStore._recovered) {
      PlayerStore._recovered = true;
      if (type === Hls.ErrorTypes.NETWORK_ERROR) {
        hls.startLoad();
        return;
      }
      if (type === Hls.ErrorTypes.MEDIA_ERROR) {
        hls.recoverMediaError();
        return;
      }
    }
    // Source fallback: try the next server, else fail.
    const next = PlayerStore.sourceIdx.value + 1;
    if (next < PlayerStore.sources.value.length) {
      PlayerStore.startSource(next, PlayerStore.video?.currentTime ?? 0);
    } else if (type === Hls.ErrorTypes.NETWORK_ERROR) {
      PlayerStore.fail('Stream non raggiungibile.');
    } else {
      PlayerStore.fail('Errore di riproduzione.');
    }
  },

  fail(msg: string): void {
    PlayerStore.state.value = 'error';
    PlayerStore.errorMessage.value = msg;
  },

  /** Periodic progress save (throttled ~1/s). Called from timeupdate. */
  saveProgress(): void {
    const v = PlayerStore.video;
    const route = PlayerStore.route;
    if (!PlayerStore._progressEnabled || !v || !route) return;
    const now = Date.now();
    if (now - PlayerStore.lastSaveTs < 1000) return;
    PlayerStore.lastSaveTs = now;
    const pos = v.currentTime;
    const dur = v.duration || 0;
    const season = route.mediaType === 'movie' ? 0 : route.resumeSeason ?? 1;
    const episode = route.mediaType === 'movie' ? 0 : route.resumeEpisode ?? 1;
    repo
      .upsertProgress({
        tmdbId: route.tmdbId,
        mediaType: route.mediaType,
        season,
        episode,
        positionSeconds: pos,
        durationSeconds: dur,
        title: route.title ?? '',
        posterPath: route.poster ?? null,
        updatedAt: now,
        providerEpisodeId: route.mediaType === 'anime' ? Number(route.animeEpisodeId) || null : null,
        providerSlug: route.mediaType === 'anime' ? route.animeSlug ?? null : null
      })
      .catch(() => {});
    repo
      .addToHistory({
        tmdbId: route.tmdbId,
        mediaType: route.mediaType,
        title: route.title ?? '',
        posterPath: route.poster ?? null,
        season,
        episode,
        watchedAt: now,
        watchedDay: startOfDay(now),
        progressSeconds: pos,
        durationSeconds: dur
      })
      .catch(() => {});
  },

  /** Final save on pause/exit/ended. Marks completed if past the threshold. */
  saveProgressFinal(): void {
    const v = PlayerStore.video;
    const route = PlayerStore.route;
    if (!PlayerStore._progressEnabled || !v || !route) return;
    const pos = v.currentTime;
    const dur = v.duration || 0;
    const completed = dur > 0 && pos >= dur * WATCHED_THRESHOLD;
    const season = route.mediaType === 'movie' ? 0 : route.resumeSeason ?? 1;
    const episode = route.mediaType === 'movie' ? 0 : route.resumeEpisode ?? 1;
    repo
      .upsertProgress({
        tmdbId: route.tmdbId,
        mediaType: route.mediaType,
        season,
        episode,
        positionSeconds: completed ? dur : pos,
        durationSeconds: dur,
        title: route.title ?? '',
        posterPath: route.poster ?? null,
        updatedAt: Date.now(),
        providerEpisodeId: route.mediaType === 'anime' ? Number(route.animeEpisodeId) || null : null,
        providerSlug: route.mediaType === 'anime' ? route.animeSlug ?? null : null
      })
      .catch(() => {});
    PlayerStore.lastSaveTs = 0;
  },

  /** Build the route for the next/previous episode, or null. */
  async nextRoute(): Promise<PlayerRoute | null> {
    return PlayerStore.episodeRoute(1);
  },
  async prevRoute(): Promise<PlayerRoute | null> {
    return PlayerStore.episodeRoute(-1);
  },

  async episodeRoute(dir: 1 | -1): Promise<PlayerRoute | null> {
    const route = PlayerStore.route;
    if (!route || route.mediaType !== 'tv') return null;
    try {
      const det = await TMDBClient.details(route.tmdbId, 'tv');
      const item = toTvItem(det);
      const s = route.resumeSeason ?? 1;
      const e = route.resumeEpisode ?? 1;
      const target = dir > 0 ? nextEpisode(item, s, e) : previousEpisode(item, s, e);
      if (!target) return null;
      return {
        ...route,
        resumeSeason: target[0],
        resumeEpisode: target[1]
      };
    } catch {
      return null;
    }
  },

  /** Reset all signals for a fresh load. */
  reset(): void {
    PlayerStore._progressEnabled = false;
    PlayerStore.lastSaveTs = 0;
    PlayerStore.state.value = 'idle';
    PlayerStore.errorMessage.value = null;
    PlayerStore.paused.value = true;
    PlayerStore.buffering.value = false;
    PlayerStore.ended.value = false;
    PlayerStore.positionSec.value = 0;
    PlayerStore.durationSec.value = 0;
    PlayerStore.bufferedSec.value = 0;
    PlayerStore.pendingSeekMs.value = -1;
    PlayerStore.controlsVisible.value = false;
    PlayerStore.settingsOpen.value = false;
    PlayerStore.scrubbing.value = false;
    PlayerStore.scrubAnchorMs.value = -1;
    PlayerStore.seekbarFocused.value = false;
    PlayerStore.sources.value = [];
    PlayerStore.sourceIdx.value = 0;
    PlayerStore.subtitleTracks.value = [];
    PlayerStore.subtitleIdx.value = -1;
    PlayerStore.audioTracks.value = [];
    PlayerStore.audioIdx.value = -1;
    PlayerStore.speed.value = 1;
    PlayerStore.quality.value = settings.streamingQualityWifi.value;
    PlayerStore.aspect.value = 'contain';
    PlayerStore.hasNext.value = false;
    PlayerStore.hasPrev.value = false;
  }
};

// re-export the media-type for screens that import from the store
export type { MediaType };
