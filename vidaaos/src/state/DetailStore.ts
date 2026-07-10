// Singleton store backing the Detail screen. Holds the dto-shaped item from
// TMDBClient.details and the camelCase tvlogic-shaped episodes list.
// Navigation is the screen's job: this store only sets pendingNav; the screen
// reads it and calls navigate(), then clearPendingNav().
import { signal, type Signal } from '@preact/signals';
import { TMDBClient } from '../data/tmdb/TMDBClient';
import {
  displayTitle,
  primaryDate,
  type TmdbItem,
  type TmdbEpisodeDetail as DtoEpisode,
} from '../data/tmdb/dto';
import { repo } from '../data/repositories';
import {
  movieSource,
  episodeSource,
  confirmCandidate as confirmProviderCandidate,
  saveMapping as saveProviderMapping,
  loadAndPrime,
} from '../data/provider/ProviderResolver';
import type {
  ProviderCandidate,
  PlaybackResolution,
  MediaType,
} from '../data/provider/models';
import {
  availableSeasons,
  airedEpisodeList,
  type TmdbItem as TvItem,
  type TmdbEpisodeDetail as TvEpisode,
} from '../util/tvlogic';
import { toTvItem, toTvEpisodes } from '../util/tmdbToTvlogic';
import type { PlayerRoute } from '../router/routes';

const WATCHED_THRESHOLD = 0.9;

type PendingPlay =
  | { kind: 'movie' }
  | { kind: 'episode'; season: number; episode: number };

export const DetailStore = {
  item: signal<TmdbItem | null>(null) as Signal<TmdbItem | null>,
  episodes: signal<TvEpisode[]>([]) as Signal<TvEpisode[]>,
  selectedSeason: signal<number>(1) as Signal<number>,
  availableSeasonsList: signal<number[]>([]) as Signal<number[]>,
  resume: signal<{ season: number; episode: number } | null>(null) as Signal<
    { season: number; episode: number } | null
  >,
  lastWatched: signal<{ season: number; episode: number } | null>(null) as Signal<
    { season: number; episode: number } | null
  >,
  inWatchlist: signal<boolean>(false) as Signal<boolean>,
  recommendations: signal<TmdbItem[]>([]) as Signal<TmdbItem[]>,
  loading: signal<boolean>(false) as Signal<boolean>,
  error: signal<boolean>(false) as Signal<boolean>,
  showPicker: signal<boolean>(false) as Signal<boolean>,
  candidates: signal<ProviderCandidate[]>([]) as Signal<ProviderCandidate[]>,
  resolveMessage: signal<string | null>(null) as Signal<string | null>,
  pendingNav: signal<PlayerRoute | null>(null) as Signal<PlayerRoute | null>,
  pendingPlay: signal<PendingPlay | null>(null) as Signal<PendingPlay | null>,

  async load(
    tmdbId: number,
    mediaType: MediaType,
    resumeSeason?: number,
    resumeEpisode?: number,
  ): Promise<void> {
    DetailStore.item.value = null;
    DetailStore.episodes.value = [];
    DetailStore.availableSeasonsList.value = [];
    DetailStore.resume.value = null;
    DetailStore.lastWatched.value = null;
    DetailStore.recommendations.value = [];
    DetailStore.showPicker.value = false;
    DetailStore.candidates.value = [];
    DetailStore.resolveMessage.value = null;
    DetailStore.pendingNav.value = null;
    DetailStore.pendingPlay.value = null;
    DetailStore.loading.value = true;
    DetailStore.error.value = false;
    try {
      const item = await TMDBClient.details(tmdbId, mediaType);
      DetailStore.item.value = item;
      const tvItem = toTvItem(item);
      DetailStore.availableSeasonsList.value = availableSeasons(tvItem);
      const lastWatched = await repo.getLatestHistoryForTitle(tmdbId, mediaType);
      DetailStore.lastWatched.value = lastWatched
        ? { season: lastWatched.season, episode: lastWatched.episode }
        : null;

      // Resume: explicit args win; else latest progress if not completed.
      if (resumeSeason != null && resumeEpisode != null) {
        DetailStore.resume.value = { season: resumeSeason, episode: resumeEpisode };
      } else {
        const latest = await repo.getLatestProgressForTitle(tmdbId, mediaType);
        if (
          latest &&
          (latest.durationSeconds <= 0 ||
            latest.positionSeconds < latest.durationSeconds * WATCHED_THRESHOLD)
        ) {
          DetailStore.resume.value = {
            season: latest.season,
            episode: latest.episode,
          };
        } else {
          DetailStore.resume.value = null;
        }
      }

      DetailStore.inWatchlist.value = await repo.isInWatchlist(tmdbId, mediaType);
      DetailStore.recommendations.value = await TMDBClient.recommendations(
        tmdbId,
        mediaType,
      );
      try {
        await loadAndPrime(tmdbId, mediaType);
      } catch {
        // best-effort
      }

      // Only fetch a season for tv series — a movie id 404s on tv/.../season/N.
      if (DetailStore.currentMediaType() === 'tv') {
        const startSeason =
          resumeSeason ?? DetailStore.lastWatched.value?.season ?? DetailStore.availableSeasonsList.value[0] ?? 1;
        await DetailStore.selectSeason(startSeason);
      }
    } catch {
      DetailStore.error.value = true;
    } finally {
      DetailStore.loading.value = false;
    }
  },

  async selectSeason(n: number): Promise<void> {
    DetailStore.selectedSeason.value = n;
    const item = DetailStore.item.value;
    if (!item) return;
    try {
      const season = await TMDBClient.seasonDetails(item.id, n);
      const tvEpisodes = toTvEpisodes(season.episodes ?? []);
      DetailStore.episodes.value = airedEpisodeList(
        tvEpisodes,
        toTvItem(item),
        n,
      );
    } catch {
      DetailStore.episodes.value = [];
    }
  },

  async toggleWatchlist(): Promise<void> {
    const item = DetailStore.item.value;
    if (!item) return;
    const id = item.id;
    const mediaType = DetailStore.currentMediaType();
    if (DetailStore.inWatchlist.value) {
      await repo.removeFromWatchlist(id, mediaType);
      DetailStore.inWatchlist.value = false;
    } else {
      await repo.addToWatchlist({
        tmdbId: id,
        mediaType,
        title: displayTitle(item),
        posterPath: item.poster_path,
        addedAt: Date.now(),
      });
      DetailStore.inWatchlist.value = true;
    }
  },

  async play(): Promise<void> {
    const item = DetailStore.item.value;
    if (!item) return;
    const releaseDate = primaryDate(item);
    const res = await movieSource(
      item.id,
      displayTitle(item),
      releaseDate,
    );
    DetailStore.handleResolution(res, { kind: 'movie' });
  },

  async playEpisode(season: number, episode: number): Promise<void> {
    const item = DetailStore.item.value;
    if (!item) return;
    const res = await episodeSource(
      item.id,
      displayTitle(item),
      primaryDate(item),
      season,
      episode,
    );
    DetailStore.handleResolution(res, { kind: 'episode', season, episode });
  },

  async confirmCandidate(c: ProviderCandidate): Promise<void> {
    const item = DetailStore.item.value;
    if (!item) return;
    const mediaType = DetailStore.currentMediaType();
    confirmProviderCandidate(c, item.id, mediaType);
    // ponytail: skip explicit saveMapping here — confirmCandidate primes the
    // in-memory cache and the retry below resolves through it. Persistent
    // mapping is best-effort; rely on the primed cache for this session.
    try {
      await saveProviderMapping(item.id, mediaType, {
        resolved: {
          id: c.providerTitleId,
          slug: c.providerSlug ?? null,
          title: c.title,
          mediaType,
        },
        reason: null,
        candidates: DetailStore.candidates.value,
        matchStatus: 'manual_confirmed',
      });
    } catch {
      // best-effort
    }
    DetailStore.showPicker.value = false;
    const pending = DetailStore.pendingPlay.value;
    if (!pending) return;
    if (pending.kind === 'movie') {
      await DetailStore.play();
    } else {
      await DetailStore.playEpisode(pending.season, pending.episode);
    }
  },

  closePicker(): void {
    DetailStore.showPicker.value = false;
  },

  clearPendingNav(): void {
    DetailStore.pendingNav.value = null;
  },

  /** mediaType for the loaded item, as the provider knows it ('movie'|'tv'). */
  currentMediaType(): MediaType {
    const item = DetailStore.item.value;
    const mt = item?.media_type;
    if (mt === 'movie' || mt === 'tv') return mt;
    // Fall back to the selectedSeason signal's presence as a tv hint.
    // ponytail: Detail only handles movie/tv; if media_type is absent, assume
    // tv when seasons exist, else movie.
    if (item?.seasons && item.seasons.length > 0) return 'tv';
    return 'movie';
  },

  handleResolution(res: PlaybackResolution, play: PendingPlay): void {
    const item = DetailStore.item.value;
    if (!item) return;
    const mediaType = DetailStore.currentMediaType();
    if (res.sources.length > 0) {
      if (res.providerTitle) {
        // best-effort: fire-and-forget, never blocks navigation
        saveProviderMapping(item.id, mediaType, {
          resolved: res.providerTitle,
          reason: res.reason,
          candidates: res.candidates,
          matchStatus: 'auto_confirmed',
        }).catch(() => {});
      }
      const route: PlayerRoute = {
        name: 'player',
        mediaType,
        tmdbId: item.id,
        resumeSeason: play.kind === 'episode' ? play.season : undefined,
        resumeEpisode: play.kind === 'episode' ? play.episode : undefined,
        title: displayTitle(item),
        // ponytail: raw TMDB poster path (e.g. "/abc.jpg"), NOT a full URL. Matches
        // Android (poster = item.posterPath) so PlayerStore can store it verbatim as
        // ProgressEntry.posterPath, and ProgressMediaCard rebuilds the URL via
        // TMDBImage.url(path, size) at render time. Storing a full URL here would double-wrap.
        poster: item.poster_path ?? undefined,
        releaseDate: primaryDate(item) ?? undefined,
      };
      DetailStore.pendingNav.value = route;
      DetailStore.pendingPlay.value = play;
      DetailStore.showPicker.value = false;
      DetailStore.candidates.value = [];
      DetailStore.resolveMessage.value = null;
    } else if (res.candidates.length > 0) {
      DetailStore.candidates.value = res.candidates;
      DetailStore.showPicker.value = true;
      DetailStore.pendingPlay.value = play;
      DetailStore.resolveMessage.value = null;
    } else {
      DetailStore.resolveMessage.value = res.message ?? 'Titolo non disponibile';
      DetailStore.showPicker.value = false;
    }
  },
};
