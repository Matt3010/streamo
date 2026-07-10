// Singleton store backing the Library screen. Same pattern as HomeStore.
import { signal, type Signal } from '@preact/signals';
import { repo } from '../data/repositories';
import type { ProgressEntry, WatchlistEntry, HistoryEntry } from '../data/db';

export const LibraryStore = {
  continueEntries: signal<ProgressEntry[]>([]) as Signal<ProgressEntry[]>,
  watchlistEntries: signal<WatchlistEntry[]>([]) as Signal<WatchlistEntry[]>,
  historyEntries: signal<HistoryEntry[]>([]) as Signal<HistoryEntry[]>,
  loading: signal<boolean>(false) as Signal<boolean>,
  error: signal<boolean>(false) as Signal<boolean>,

  async load(): Promise<void> {
    LibraryStore.loading.value = true;
    LibraryStore.error.value = false;
    try {
      const [continueEntries, watchlistEntries, historyEntries] = await Promise.all([
        repo.continueWatching(),
        repo.watchlist(),
        repo.history(),
      ]);
      LibraryStore.continueEntries.value = continueEntries;
      LibraryStore.watchlistEntries.value = watchlistEntries;
      LibraryStore.historyEntries.value = historyEntries;
    } catch {
      LibraryStore.error.value = true;
    } finally {
      LibraryStore.loading.value = false;
    }
  },
};