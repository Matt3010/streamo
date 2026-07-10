import { useEffect, useRef } from 'preact/hooks';
import { useSignal } from '@preact/signals';
import { setFocus } from '@noriginmedia/norigin-spatial-navigation-core';
import { SearchStore, type SearchFilter } from '../state/SearchStore';
import { MediaCard } from '../components/MediaCard';
import { OptionOverlay } from '../components/OptionOverlay';
import { Focusable } from '../spatial/Focusable';
import { restoreFocus, recoverFocus } from '../spatial/focusMemory';
import { routeToPath } from '../router/routes';
import { useInfiniteScroll } from '../util/useInfiniteScroll';
import { InlineIcon, ICON_PATHS } from '../components/Icon';
import { pushBackHandler } from '../router/BackHandler';
import { useNav } from '../router/Router';
import { settings } from '../data/settings';
import { strings } from '../i18n/strings';
import { enableVirtualKeyboard } from '../util/device';

const SORT_OPTIONS = [
  { id: 'POPULARITY', label: 'Popolarità', field: 'POPULARITY' },
  { id: 'VOTE_AVERAGE', label: 'Voto', field: 'VOTE_AVERAGE' },
  { id: 'PRIMARY_DATE', label: 'Più recenti', field: 'PRIMARY_DATE' },
];

export function SearchScreen() {
  const { navigate } = useNav();
  const inputRef = useRef<HTMLInputElement>(null);
  const openSort = useSignal(false);
  const openFilter = useSignal(false);

  const query = SearchStore.query.value;
  const filter = SearchStore.filter.value;
  const results = SearchStore.results.value;
  const recent = SearchStore.recent.value;
  const genres = SearchStore.genres.value;
  const selectedGenres = SearchStore.selectedGenres.value;

  // Area 4: paginazione scroll-math unificata (sostituisce l'IntersectionObserver
  // fragile, che perdeva il target durante lo swap nodi). nearBottom serve anche
  // al fill-viewport iniziale.
  const { ref: screenRef, nearBottom } = useInfiniteScroll<HTMLDivElement>({
    hasMore: () => SearchStore.hasMore.value,
    loading: () => SearchStore.loading.value,
    loadMore: () => void SearchStore.loadMore()
  });

  useEffect(() => {
    void SearchStore.loadRecent().catch(() => {});
    void SearchStore.loadGenres().catch(() => {});
    // Area 1: ripristina la posizione ricordata col Back se ci sono risultati,
    // altrimenti focus sull'input. SearchStore è singleton → query/results
    // sopravvivono allo smontaggio.
    const r = SearchStore.results.value;
    if (SearchStore.query.value.trim().length > 0 && r.length > 0) {
      return restoreFocus(routeToPath({ name: 'search' }), `search-res-${r[0].id}`);
    }
    const id = requestAnimationFrame(() => setFocus('search-input'));
    return () => cancelAnimationFrame(id);
  }, []);

  // Back closes overlays.
  useEffect(
    () =>
      pushBackHandler(() => {
        if (openSort.value) {
          openSort.value = false;
          return true;
        }
        if (openFilter.value) {
          openFilter.value = false;
          return true;
        }
        return false;
      }),
    [],
  );

  // Area 4: fill-viewport. La prima pagina di risultati potrebbe non riempire lo
  // schermo (prima ci pensava l'IO); carica finché non è coperto. recoverFocus
  // (Area 3) atterra sul primo risultato nuovo se il focus era su uno rimosso.
  useEffect(() => {
    if (SearchStore.results.value.length === 0) return;
    const cancelRecover = recoverFocus([
      `search-res-${SearchStore.results.value[0].id}`,
      'search-input'
    ]);
    if (SearchStore.hasMore.value && !SearchStore.loading.value && nearBottom()) {
      void SearchStore.loadMore();
    }
    return cancelRecover;
  }, [results]);

  const setFilterAndSearch = (f: SearchFilter) => {
    SearchStore.setFilter(f);
    if (SearchStore.query.value.trim().length > 0) void SearchStore.search();
  };

  const onSortPick = (id: string | number) => {
    const opt = SORT_OPTIONS.find((o) => o.id === id);
    if (opt) settings.setSearchSort(opt.field, 'DESC');
    openSort.value = false;
    if (query.trim().length > 0) void SearchStore.search();
  };

  const onFilterPick = (id: string | number) => {
    SearchStore.toggleGenre(Number(id));
    // keep overlay open for multi-select; re-search live
    if (query.trim().length > 0) void SearchStore.search();
  };

  const goDetail = (item: typeof results[number]) =>
    navigate({
      name: 'detail',
      mediaType: (item.media_type as 'movie' | 'tv') ?? 'movie',
      tmdbId: item.id,
    });

  const filterChips: { id: SearchFilter; label: string }[] = [
    { id: 'all', label: strings.all },
    { id: 'movie', label: strings.movies },
    { id: 'tv', label: strings.tv },
  ];

  return (
    <div class="screen" ref={screenRef}>
      <div class="search-bar">
        <Focusable
          focusKey="search-input"
          ring
          fill
          onSelect={() => inputRef.current?.focus()}
          onFocus={() => {
            inputRef.current?.focus();
            enableVirtualKeyboard();
          }}
          className="search-input-wrap"
        >
          <input
            ref={inputRef}
            class="search-input"
            type="text"
            placeholder={strings.search}
            value={query}
            onInput={(e) => SearchStore.setQuery(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void SearchStore.search();
              }
            }}
          />
        </Focusable>

        <div class="filter-bar">
          {filterChips.map((c) => (
            <Focusable
              key={c.id}
              focusKey={`search-filter-${c.id}`}
              ring
              fill
              onSelect={() => setFilterAndSearch(c.id)}
              className={`filter-chip${filter === c.id ? ' selected' : ''}`}
            >
              <span>{c.label}</span>
            </Focusable>
          ))}
          <Focusable
            focusKey="search-sort"
            ring
            fill
            onSelect={() => (openSort.value = true)}
            className="filter-chip"
          >
            <InlineIcon path={ICON_PATHS.sort} size={18} />
            <span>{strings.sort}</span>
          </Focusable>
          <Focusable
            focusKey="search-filter-btn"
            ring
            fill
            onSelect={() => (openFilter.value = true)}
            className="filter-chip"
          >
            <InlineIcon path={ICON_PATHS.filterList} size={18} />
            <span>{strings.filter}</span>
          </Focusable>
        </div>
      </div>

      {query.trim().length === 0 ? (
        <section class="rail">
          <div class="rail-title">{strings.recentSearches}</div>
          <div class="recent-list">
            {recent.map((r) => (
              <Focusable
                key={r.query}
                focusKey={`search-recent-${r.query}`}
                ring
                fill
                onSelect={() => {
                  SearchStore.setQuery(r.query);
                  void SearchStore.search();
                }}
                className="recent-row"
              >
                <span>{r.query}</span>
              </Focusable>
            ))}
            {recent.length === 0 && (
              <div class="empty-row">{strings.recentSearches}</div>
            )}
          </div>
        </section>
      ) : (
        <div class="grid-home">
          {results.map((item) => (
            <MediaCard
              key={`${item.id}-${item.media_type}`}
              item={item}
              focusKey={`search-res-${item.id}`}
              onSelect={goDetail}
            />
          ))}
        </div>
      )}

      {openSort.value && (
        <OptionOverlay
          title={strings.sort}
          options={SORT_OPTIONS.map((o) => ({
            id: o.id,
            label: o.label,
            selected: settings.searchSortField.value === o.field,
          }))}
          onSelect={onSortPick}
          onClose={() => (openSort.value = false)}
        />
      )}

      {openFilter.value && (
        <OptionOverlay
          title={strings.filter}
          options={genres.map((g) => ({
            id: g.id,
            label: g.name,
            selected: selectedGenres.includes(g.id),
          }))}
          onSelect={onFilterPick}
          onClose={() => (openFilter.value = false)}
        />
      )}
    </div>
  );
}
