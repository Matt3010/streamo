import { useEffect } from 'preact/hooks';
import { useSignal } from '@preact/signals';
import { TMDBClient } from '../data/tmdb/TMDBClient';
import { MediaCard } from '../components/MediaCard';
import { Spinner } from '../components/Spinner';
import { restoreFocus } from '../spatial/focusMemory';
import { routeToPath } from '../router/routes';
import { useInfiniteScroll } from '../util/useInfiniteScroll';
import { useNav } from '../router/Router';
import type { TmdbItem } from '../data/tmdb/dto';
import type { Route } from '../router/routes';

const PRELOAD_MARGIN = 400;

export function SectionListScreen({
  route,
}: {
  route: Extract<Route, { name: 'sectionList' }>;
}) {
  const { navigate } = useNav();
  const items = useSignal<TmdbItem[]>([]);
  const loading = useSignal(true);
  const page = useSignal(1);
  const hasMore = useSignal(true);

  // Area 4: paginazione scroll-math unificata via useInfiniteScroll. Legge lo
  // stato live a ogni evento e si attacca una sola volta, immune alla
  // sostituzione del nodo (vedi la storia dell'IntersectionObserver inerte).
  const { ref: screenRef, nearBottom } = useInfiniteScroll<HTMLDivElement>({
    hasMore: () => hasMore.value,
    loading: () => loading.value,
    loadMore: () => fetchPage(page.value + 1, false),
    margin: PRELOAD_MARGIN
  });

  const fetchPage = (p: number, anchor = false) => {
    loading.value = true;
    TMDBClient.list(route.endpoint, p)
      .then((batch) => {
        // ponytail: TMDB date-windowed endpoints (trending/now_playing/on_the_air)
        // overlap a single item across page boundaries, so the same id can come
        // back on page N+1. Dedupe by id — otherwise we get duplicate React keys
        // AND duplicate Norigin focusKeys (sec-${id}) on the same screen, which
        // breaks focus. hasMore still keys off the raw batch length so a full
        // page keeps paging.
        const seen = new Set(items.value.map((i) => i.id));
        const fresh = batch.filter((b) => !seen.has(b.id));
        items.value = [...items.value, ...fresh];
        page.value = p;
        hasMore.value = batch.length >= 20;
        // ponytail: anchor only on the initial mount load, to the FIRST card
        // (top-left, no scroll). Anchoring to the LAST card yanked focus to the
        // bottom and scrollFocusedIntoView scrolled the screen all the way down
        // — which kept the bottom in the preload zone, so paging ran away
        // ("scrolled to infinity then stopped") and left the screen at the
        // bottom so user scroll couldn't trigger more. Fill/scroll fetches pass
        // anchor=false so they never steal focus.
        if (anchor) {
          const first = items.value[0];
          if (first) restoreFocus(routeToPath(route), `sec-${first.id}`);
        }
        // ponytail: fill-viewport. After a page renders, if we're still near the
        // bottom (content shorter than the viewport), keep paging so a short
        // grid fills the screen instead of stalling at one page. Deferred one
        // rAF so scrollHeight reflects the just-appended cards. Bounded by
        // hasMore + the loading guard, so it can't run away.
        requestAnimationFrame(() => {
          if (hasMore.value && !loading.value && nearBottom()) {
            fetchPage(p + 1, false);
          }
        });
      })
      .catch(() => {
        hasMore.value = false;
      })
      .finally(() => {
        loading.value = false;
      });
  };

  useEffect(() => {
    items.value = [];
    page.value = 1;
    hasMore.value = true;
    fetchPage(1, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.endpoint]);

  const goDetail = (item: TmdbItem) =>
    navigate({
      name: 'detail',
      mediaType: (item.media_type as 'movie' | 'tv') ?? route.mediaType,
      tmdbId: item.id,
    });

  return (
    <div class="screen" ref={screenRef}>
      <div class="rail-title section-header">{route.title}</div>
      {loading.value && items.value.length === 0 ? (
        <Spinner />
      ) : (
        <div class="grid-home">
          {items.value.map((item) => (
            <MediaCard
              key={`${item.id}-${item.media_type}`}
              item={item}
              focusKey={`sec-${item.id}`}
              onSelect={goDetail}
            />
          ))}
        </div>
      )}
    </div>
  );
}