import { signal, type Signal } from '@preact/signals';
import { AnimeUnityClient, type AUAnime } from '../data/anime/AnimeUnityClient';
import { repo } from '../data/repositories';
import type { ProgressEntry } from '../data/db';

let debounce: number | null = null;

export const AnimeStore = {
  catalog: signal<AUAnime[]>([]) as Signal<AUAnime[]>,
  query: signal('') as Signal<string>,
  loading: signal(false) as Signal<boolean>,
  error: signal<string | null>(null) as Signal<string | null>,
  continueEntries: signal<ProgressEntry[]>([]) as Signal<ProgressEntry[]>,
  offset: 0,
  endReached: false,
  loaded: false,

  async loadContinue(): Promise<void> {
    const all = await repo.progress();
    const latest = new Map<number, ProgressEntry>();
    for (const row of all) {
      if (row.mediaType !== 'anime') continue;
      const old = latest.get(row.tmdbId);
      if (!old || old.updatedAt < row.updatedAt) latest.set(row.tmdbId, row);
    }
    AnimeStore.continueEntries.value = [...latest.values()].filter(
      (x) => x.durationSeconds <= 0 || x.positionSeconds < x.durationSeconds * 0.9,
    );
  },

  async reload(): Promise<void> {
    AnimeStore.loading.value = true;
    AnimeStore.error.value = null;
    AnimeStore.offset = 0;
    AnimeStore.endReached = false;
    try {
      AnimeStore.catalog.value = await AnimeUnityClient.browse();
      AnimeStore.endReached = AnimeStore.catalog.value.length === 0;
      AnimeStore.loaded = true;
    } catch {
      AnimeStore.error.value = 'Impossibile caricare il catalogo. Controlla la connessione.';
    } finally {
      AnimeStore.loading.value = false;
    }
  },

  async loadMore(): Promise<void> {
    if (AnimeStore.loading.value || AnimeStore.endReached || AnimeStore.query.value.trim()) return;
    AnimeStore.loading.value = true;
    try {
      const next = await AnimeUnityClient.browse(AnimeStore.offset + 30);
      if (next.length) {
        AnimeStore.catalog.value = [...AnimeStore.catalog.value, ...next];
        AnimeStore.offset += 30;
      } else AnimeStore.endReached = true;
    } finally {
      AnimeStore.loading.value = false;
    }
  },

  setQuery(value: string): void {
    AnimeStore.query.value = value;
    if (debounce != null) clearTimeout(debounce);
    if (!value.trim()) {
      if (AnimeStore.loaded) void AnimeStore.reload();
      return;
    }
    debounce = window.setTimeout(async () => {
      AnimeStore.loading.value = true;
      AnimeStore.error.value = null;
      try {
        AnimeStore.catalog.value = await AnimeUnityClient.search(value);
        AnimeStore.endReached = true;
      } catch {
        AnimeStore.error.value = 'Ricerca non disponibile. Riprova.';
      } finally {
        AnimeStore.loading.value = false;
      }
    }, 350);
  },
};
