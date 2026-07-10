import { useEffect } from 'preact/hooks';
import { HomeStore } from '../state/HomeStore';
import { homeSections, SECTION_ICONS } from '../state/homeSections';
import { ImmersiveRow } from '../components/ImmersiveRow';
import { SectionRow } from '../components/SectionRow';
import { MediaCard } from '../components/MediaCard';
import { ProgressMediaCard } from '../components/ProgressMediaCard';
import { Focusable } from '../spatial/Focusable';
import { restoreFocus } from '../spatial/focusMemory';
import { routeToPath } from '../router/routes';
import { useNav } from '../router/Router';
import { strings } from '../i18n/strings';
import type { TmdbItem } from '../data/tmdb/dto';
import type { ProgressEntry, WatchlistEntry } from '../data/db';

export function HomeScreen() {
  const { navigate } = useNav();
  const cw = HomeStore.continueEntries.value;
  const wl = HomeStore.watchlistEntries.value;
  const err = HomeStore.error.value;

  useEffect(() => {
    void HomeStore.load();
  }, []);

  // Anchor: first non-empty row's first card. Ripristina la posizione ricordata
  // col Back, fallback sulla prima card. setFocus dopo che i dati sono pronti.
  useEffect(() => {
    if (err) return;
    if (HomeStore.loading.value) return;
    const anchor =
      cw.length > 0
        ? `home-cw-${cw[0].tmdbId}`
        : wl.length > 0
          ? `home-wl-${wl[0].tmdbId}`
          : null;
    if (!anchor) return; // ponytail: cold load lets first SectionRow forceFirstFocus
    return restoreFocus(routeToPath({ name: 'home' }), anchor);
  }, [err, HomeStore.loading.value, cw.length, wl.length]);

  const goDetail = (e: ProgressEntry) =>
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

  if (err) {
    return (
      <div class="screen">
        <div class="stub">
          <div>{strings.catalogUnavailable}</div>
          <Focusable
            focusKey="home-retry"
            fill
            ring
            scale={1.05}
            onSelect={() => void HomeStore.load()}
            className="retry-btn"
          >
            <span>{strings.retry}</span>
          </Focusable>
        </div>
      </div>
    );
  }

  return (
    <div class="screen">
      {cw.length > 0 && (
        <ImmersiveRow
          title={strings.continueWatching}
          icon={SECTION_ICONS.continueWatching}
          focusKey="home-cw"
        >
          {cw.map((e, i) => (
            <ProgressMediaCard
              key={`cw-${e.tmdbId}-${e.season}-${e.episode}`}
              entry={e}
              focusKey={`home-cw-${e.tmdbId}`}
              railPosition={i === 0 ? 'first' : i === cw.length - 1 ? 'last' : undefined}
              onSelect={goDetail}
            />
          ))}
        </ImmersiveRow>
      )}

      {wl.length > 0 && (
        <ImmersiveRow
          title={strings.myList}
          icon={SECTION_ICONS.myList}
          focusKey="home-wl"
        >
          {wl.map((e, i) => {
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
                focusKey={`home-wl-${e.tmdbId}`}
                railPosition={i === 0 ? 'first' : i === wl.length - 1 ? 'last' : undefined}
                onSelect={() => goWl(e)}
              />
            );
          })}
        </ImmersiveRow>
      )}

      {homeSections.map((s, i) => (
        <SectionRow
          key={i}
          section={s}
          focusKey={`home-sec-${i}`}
          forceFirstFocus={cw.length === 0 && wl.length === 0 && i === 0}
          onMore={() =>
            navigate({
              name: 'sectionList',
              title: s.title,
              endpoint: s.endpoint,
              mediaType: s.mediaType,
            })
          }
        />
      ))}
    </div>
  );
}