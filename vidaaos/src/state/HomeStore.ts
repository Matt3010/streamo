// Singleton store backing the Home screen. Plain module-level signals —
// navigation is the screen's job, this store never imports useNav.
import { signal, type Signal } from '@preact/signals';
import { repo } from '../data/repositories';
import { TMDBClient } from '../data/tmdb/TMDBClient';
import type { ProgressEntry, WatchlistEntry } from '../data/db';

export const HomeStore = {
  continueEntries: signal<ProgressEntry[]>([]) as Signal<ProgressEntry[]>,
  watchlistEntries: signal<WatchlistEntry[]>([]) as Signal<WatchlistEntry[]>,
  loading: signal<boolean>(false) as Signal<boolean>,
  error: signal<boolean>(false) as Signal<boolean>,

  async load(): Promise<void> {
    HomeStore.loading.value = true;
    HomeStore.error.value = false;
    try {
      const [continueEntries, watchlistEntries] = await Promise.all([
        repo.continueWatching(),
        repo.watchlist(),
      ]);
      HomeStore.continueEntries.value = continueEntries;
      HomeStore.watchlistEntries.value = watchlistEntries;
      // ponytail: backfill posters for progress entries saved before the
      // PlayerStore posterPath fix (posterPath was null). Fetch TMDB details once
      // per title and persist so existing cards show a cover without a replay.
      // Fire-and-forget: row shows with placeholders first, covers pop in after.
      void HomeStore.healPosters(continueEntries);
    } catch {
      HomeStore.error.value = true;
    } finally {
      HomeStore.loading.value = false;
    }
  },

  async healPosters(entries: ProgressEntry[]): Promise<void> {
    const missing = entries.filter((e) => !e.posterPath || e.posterPath.trim().length === 0);
    if (!missing.length) return;
    const done = new Set<string>();
    for (const e of missing) {
      const key = `${e.tmdbId}|${e.mediaType}`;
      if (done.has(key)) continue;
      done.add(key);
      try {
        const item = await TMDBClient.details(e.tmdbId, e.mediaType);
        if (!item.poster_path) continue;
        await repo.upsertProgress({ ...e, posterPath: item.poster_path });
        HomeStore.continueEntries.value = HomeStore.continueEntries.value.map((c) =>
          c === e ? { ...c, posterPath: item.poster_path } : c,
        );
      } catch {
        // best-effort: card stays on the placeholder
      }
    }
  },
};