// Singleton store backing the Search screen. Sort settings are read from
// settings but TMDB search endpoints don't support sort_by, so only
// selectedGenres is applied (ponytail: sort ignored for search endpoints).
import { signal, type Signal } from '@preact/signals';
import { TMDBClient } from '../data/tmdb/TMDBClient';
import { repo } from '../data/repositories';
import { settings } from '../data/settings';
import type { TmdbItem, TmdbGenre } from '../data/tmdb/dto';
import type { SearchHistoryEntry } from '../data/db';

export type SearchFilter = 'all' | 'movie' | 'tv';

export const SearchStore = {
  query: signal<string>('') as Signal<string>,
  filter: signal<SearchFilter>('all') as Signal<SearchFilter>,
  results: signal<TmdbItem[]>([]) as Signal<TmdbItem[]>,
  loading: signal<boolean>(false) as Signal<boolean>,
  page: signal<number>(1) as Signal<number>,
  hasMore: signal<boolean>(true) as Signal<boolean>,
  recent: signal<SearchHistoryEntry[]>([]) as Signal<SearchHistoryEntry[]>,
  genres: signal<TmdbGenre[]>([]) as Signal<TmdbGenre[]>,
  selectedGenres: signal<number[]>([]) as Signal<number[]>,

  setQuery(q: string): void {
    SearchStore.query.value = q;
  },

  setFilter(f: SearchFilter): void {
    SearchStore.filter.value = f;
    SearchStore.results.value = [];
    SearchStore.page.value = 1;
    SearchStore.hasMore.value = true;
  },

  async search(): Promise<void> {
    const q = SearchStore.query.value.trim();
    if (q.length === 0) {
      SearchStore.results.value = [];
      return;
    }
    SearchStore.loading.value = true;
    try {
      const filter = SearchStore.filter.value;
      const genreIds = SearchStore.selectedGenres.value.length
        ? SearchStore.selectedGenres.value
        : null;
      let items: TmdbItem[];
      if (filter === 'all') {
        items = (await Promise.all([
          TMDBClient.searchMovie(q, 1, genreIds),
          TMDBClient.searchTv(q, 1, genreIds),
        ])).flat();
      } else if (filter === 'movie') {
        items = await TMDBClient.searchMovie(q, 1, genreIds);
      } else {
        items = await TMDBClient.searchTv(q, 1, genreIds);
      }
      SearchStore.results.value = items;
      SearchStore.page.value = 1;
      SearchStore.hasMore.value = items.length >= 20;
      // ponytail: sort ignored — TMDB search endpoints don't support sort_by.
      void settings.searchSortField.value;
      void settings.searchSortOrder.value;
      try {
        await repo.addSearchHistory(q);
        SearchStore.recent.value = await repo.searchHistory();
      } catch {
        // best-effort history
      }
    } catch {
      SearchStore.results.value = [];
    } finally {
      SearchStore.loading.value = false;
    }
  },

  async loadMore(): Promise<void> {
    if (!SearchStore.hasMore.value || SearchStore.loading.value) return;
    const nextPage = SearchStore.page.value + 1;
    SearchStore.loading.value = true;
    try {
      const q = SearchStore.query.value.trim();
      const filter = SearchStore.filter.value;
      const genreIds = SearchStore.selectedGenres.value.length
        ? SearchStore.selectedGenres.value
        : null;
      let batch: TmdbItem[];
      if (filter === 'all') {
        batch = (await Promise.all([
          TMDBClient.searchMovie(q, nextPage, genreIds),
          TMDBClient.searchTv(q, nextPage, genreIds),
        ])).flat();
      } else if (filter === 'movie') {
        batch = await TMDBClient.searchMovie(q, nextPage, genreIds);
      } else {
        batch = await TMDBClient.searchTv(q, nextPage, genreIds);
      }
      SearchStore.results.value = [...SearchStore.results.value, ...batch];
      SearchStore.page.value = nextPage;
      SearchStore.hasMore.value = batch.length >= 20;
    } finally {
      SearchStore.loading.value = false;
    }
  },

  async loadRecent(): Promise<void> {
    SearchStore.recent.value = await repo.searchHistory();
  },

  async removeRecent(q: string): Promise<void> {
    await repo.removeSearchHistory(q);
    await SearchStore.loadRecent();
  },

  async clearRecent(): Promise<void> {
    await repo.clearSearchHistory();
    SearchStore.recent.value = [];
  },

  async loadGenres(): Promise<void> {
    SearchStore.genres.value = await TMDBClient.genres();
  },

  toggleGenre(id: number): void {
    const cur = SearchStore.selectedGenres.value;
    SearchStore.selectedGenres.value = cur.includes(id)
      ? cur.filter((g) => g !== id)
      : [...cur, id];
  },

  clear(): void {
    SearchStore.results.value = [];
    SearchStore.query.value = '';
    SearchStore.page.value = 1;
    SearchStore.hasMore.value = true;
  },
};
