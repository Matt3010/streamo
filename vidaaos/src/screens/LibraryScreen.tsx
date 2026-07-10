import { useEffect } from 'preact/hooks';
import { setFocus } from '@noriginmedia/norigin-spatial-navigation-core';
import { LibraryStore } from '../state/LibraryStore';
import { ImmersiveRow } from '../components/ImmersiveRow';
import { MediaCard } from '../components/MediaCard';
import { ProgressMediaCard } from '../components/ProgressMediaCard';
import { useNav } from '../router/Router';
import { strings } from '../i18n/strings';
import { SECTION_ICONS } from '../state/homeSections';
import type { TmdbItem } from '../data/tmdb/dto';
import type {
  HistoryEntry,
  ProgressEntry,
  WatchlistEntry,
} from '../data/db';

export function LibraryScreen() {
  const { navigate } = useNav();
  const cw = LibraryStore.continueEntries.value;
  const wl = LibraryStore.watchlistEntries.value;
  const hist = LibraryStore.historyEntries.value;

  useEffect(() => {
    void LibraryStore.load();
  }, []);

  const allEmpty = cw.length === 0 && wl.length === 0 && hist.length === 0;

  // Anchor: first non-empty row's first card.
  useEffect(() => {
    if (LibraryStore.loading.value || LibraryStore.error.value) return;
    if (allEmpty) return;
    const anchor =
      cw.length > 0
        ? `lib-cw-${cw[0].tmdbId}`
        : wl.length > 0
          ? `lib-wl-${wl[0].tmdbId}`
          : `lib-hist-${hist[0].mediaType}-${hist[0].tmdbId}-${hist[0].season}-${hist[0].episode}-${hist[0].watchedDay}`;
    const id = requestAnimationFrame(() => setFocus(anchor));
    return () => cancelAnimationFrame(id);
  }, [
    LibraryStore.loading.value,
    LibraryStore.error.value,
    allEmpty,
    cw.length,
    wl.length,
    hist.length,
  ]);

  if (allEmpty && !LibraryStore.loading.value) {
    return (
      <div class="screen">
        <div class="stub">
          <div>{strings.libraryEmpty}</div>
        </div>
      </div>
    );
  }

  const goDetail = (e: ProgressEntry) =>
    navigate({
      name: 'detail',
      mediaType: e.mediaType as 'movie' | 'tv',
      tmdbId: e.tmdbId,
      resumeSeason: e.season,
      resumeEpisode: e.episode,
    });

  const goHist = (e: HistoryEntry) =>
    navigate({
      name: 'detail',
      mediaType: e.mediaType as 'movie' | 'tv',
      tmdbId: e.tmdbId,
      resumeSeason: e.season,
      resumeEpisode: e.episode,
    });

  const goWl = (e: WatchlistEntry) =>
    navigate({
      name: 'detail',
      mediaType: e.mediaType as 'movie' | 'tv',
      tmdbId: e.tmdbId,
    });

  const histToProgress = (e: HistoryEntry): ProgressEntry =>
    ({
      tmdbId: e.tmdbId,
      mediaType: e.mediaType,
      season: e.season,
      episode: e.episode,
      positionSeconds: e.progressSeconds,
      durationSeconds: e.durationSeconds,
      title: e.title,
      posterPath: e.posterPath,
      updatedAt: e.watchedAt,
      providerEpisodeId: null,
      providerSlug: null,
    }) as ProgressEntry;

  return (
    <div class="screen">
      {cw.length > 0 && (
        <ImmersiveRow
          title={strings.continueWatching}
          icon={SECTION_ICONS.continueWatching}
          focusKey="lib-cw"
        >
          {cw.map((e) => (
            <ProgressMediaCard
              key={`cw-${e.tmdbId}-${e.season}-${e.episode}`}
              entry={e}
              focusKey={`lib-cw-${e.tmdbId}`}
              onSelect={goDetail}
            />
          ))}
        </ImmersiveRow>
      )}

      {wl.length > 0 && (
        <ImmersiveRow
          title={strings.myList}
          icon={SECTION_ICONS.myList}
          focusKey="lib-wl"
        >
          {wl.map((e) => {
            const item = {
              id: e.tmdbId,
              media_type: e.mediaType,
              title: e.title,
              name: e.title,
              poster_path: e.posterPath,
            } as TmdbItem;
            return (
              <MediaCard
                key={`wl-${e.tmdbId}`}
                item={item}
                focusKey={`lib-wl-${e.tmdbId}`}
                onSelect={() => goWl(e)}
              />
            );
          })}
        </ImmersiveRow>
      )}

      {hist.length > 0 && (
        <ImmersiveRow
          title={strings.history}
          icon={SECTION_ICONS.history}
          focusKey="lib-hist"
        >
          {hist.map((e) => (
            <ProgressMediaCard
              key={`hist-${e.mediaType}-${e.tmdbId}-${e.season}-${e.episode}-${e.watchedDay}`}
              entry={histToProgress(e)}
              focusKey={`lib-hist-${e.mediaType}-${e.tmdbId}-${e.season}-${e.episode}-${e.watchedDay}`}
              onSelect={() => goHist(e)}
            />
          ))}
        </ImmersiveRow>
      )}
    </div>
  );
}
