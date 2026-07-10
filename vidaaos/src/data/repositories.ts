// Port of AppRepository.kt. Plain async arrays (Dexie .toArray()).
// Continue-watching derivation mirrors the Android filter/group/max-by/complete filter.
import { db, type ProgressEntry, type HistoryEntry, type WatchlistEntry, type ProviderMappingEntity, type SearchHistoryEntry } from './db';

const SEARCH_HISTORY_LIMIT = 15;

function startOfDay(millis: number): number {
  const d = new Date(millis);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export const repo = {
  // --- Watchlist ---
  async watchlist(): Promise<WatchlistEntry[]> {
    return db.watchlist.orderBy('addedAt').reverse().toArray();
  },
  async isInWatchlist(id: number, mediaType: string): Promise<boolean> {
    return (await db.watchlist.get([id, mediaType])) != null;
  },
  async addToWatchlist(entry: WatchlistEntry): Promise<void> {
    await db.watchlist.put(entry);
  },
  async removeFromWatchlist(id: number, mediaType: string): Promise<void> {
    await db.watchlist.where('[tmdbId+mediaType]').equals([id, mediaType]).delete();
  },

  // --- Progress ---
  async progress(): Promise<ProgressEntry[]> {
    return db.progress.orderBy('updatedAt').reverse().toArray();
  },
  async getProgress(id: number): Promise<ProgressEntry | undefined> {
    const rows = await db.progress.where('tmdbId').equals(id).toArray();
    rows.sort((a, b) => b.updatedAt - a.updatedAt);
    return rows[0];
  },
  async getProgressByCoordinate(
    id: number,
    mediaType: string,
    season: number,
    episode: number,
  ): Promise<ProgressEntry | undefined> {
    return db.progress.get([id, mediaType, season, episode]);
  },
  async getLatestProgressForTitle(id: number, mediaType: string): Promise<ProgressEntry | undefined> {
    // ponytail: JS filter over a small per-title set; avoids Dexie compound-range
    // minKey/maxKey fiddling that crosses typed index boundaries.
    const rows = (await db.progress.toArray()).filter(
      (r) => r.tmdbId === id && r.mediaType === mediaType,
    );
    rows.sort((a, b) => b.updatedAt - a.updatedAt);
    return rows[0];
  },
  async getProgressForSeason(id: number, mediaType: string, season: number): Promise<ProgressEntry[]> {
    return (await db.progress.toArray()).filter(
      (r) => r.tmdbId === id && r.mediaType === mediaType && r.season === season,
    );
  },
  async upsertProgress(entry: ProgressEntry): Promise<void> {
    await db.progress.put(entry);
  },
  async deleteProgress(id: number): Promise<void> {
    await db.progress.where('tmdbId').equals(id).delete();
  },

  // --- History ---
  async history(): Promise<HistoryEntry[]> {
    return db.history.orderBy('watchedAt').reverse().toArray();
  },
  async getLatestHistoryForTitle(id: number, mediaType: string): Promise<HistoryEntry | undefined> {
    return (await db.history.orderBy('watchedAt').reverse().toArray()).find(
      (r) => r.tmdbId === id && r.mediaType === mediaType,
    );
  },
  async addToHistory(entry: HistoryEntry): Promise<void> {
    if (!entry.watchedDay) entry.watchedDay = startOfDay(entry.watchedAt);
    await db.history.put(entry);
  },
  async removeFromHistory(entry: HistoryEntry): Promise<void> {
    await db.history
      .where('[tmdbId+mediaType+season+episode+watchedDay]')
      .equals([entry.tmdbId, entry.mediaType, entry.season, entry.episode, entry.watchedDay])
      .delete();
  },
  async removeHistoryByTitle(tmdbId: number, mediaType: string): Promise<void> {
    const rows = await db.history.where('tmdbId').equals(tmdbId).toArray();
    const toDelete = rows
      .filter((r) => r.mediaType === mediaType)
      .map((r): [number, string, number, number, number] => [r.tmdbId, r.mediaType, r.season, r.episode, r.watchedDay]);
    await db.history.bulkDelete(toDelete);
  },

  // --- Provider mapping ---
  async getProviderMapping(id: number): Promise<ProviderMappingEntity | undefined> {
    return db.providerMapping.get(id);
  },
  async saveProviderMapping(mapping: ProviderMappingEntity): Promise<void> {
    await db.providerMapping.put(mapping);
  },
  async deleteProviderMapping(id: number): Promise<void> {
    await db.providerMapping.delete(id);
  },

  // --- Search history ---
  async searchHistory(): Promise<SearchHistoryEntry[]> {
    return db.searchHistory.orderBy('searchedAt').reverse().limit(SEARCH_HISTORY_LIMIT).toArray();
  },
  async addSearchHistory(query: string): Promise<void> {
    const entry: SearchHistoryEntry = { query, searchedAt: Date.now() };
    await db.searchHistory.put(entry);
    // trim: keep the 15 most recent
    const all = await db.searchHistory.orderBy('searchedAt').reverse().toArray();
    const stale = all.slice(SEARCH_HISTORY_LIMIT).map((e) => e.query);
    if (stale.length) await db.searchHistory.bulkDelete(stale);
  },
  async removeSearchHistory(query: string): Promise<void> {
    await db.searchHistory.delete(query);
  },
  async clearSearchHistory(): Promise<void> {
    await db.searchHistory.clear();
  },

  // --- Continue Watching ---
  // Filter mediaType !== 'anime', group by (tmdbId, mediaType), keep the most-recent
  // updatedAt per group, drop completed (position >= duration * 0.9 when duration > 0).
  async continueWatching(): Promise<ProgressEntry[]> {
    const all = await db.progress.toArray();
    const filtered = all.filter((e) => e.mediaType !== 'anime');
    const byTitle = new Map<string, ProgressEntry>();
    for (const e of filtered) {
      const key = `${e.tmdbId}|${e.mediaType}`;
      const cur = byTitle.get(key);
      if (!cur || e.updatedAt > cur.updatedAt) byTitle.set(key, e);
    }
    return [...byTitle.values()].filter(
      (e) => e.durationSeconds <= 0 || e.positionSeconds < e.durationSeconds * 0.9,
    );
  },

  // --- Cache management + library recalc (Settings/CacheManagement) ---
  async tmdbCacheCount(): Promise<number> {
    return db.tmdbCache.count();
  },
  async clearTmdbCache(): Promise<void> {
    await db.tmdbCache.clear();
  },
  /** Best-effort image cache clear via the Cache API (TMDB poster backdrop URLs,
   *  if anything cached them). No-op if the API is unavailable. */
  async clearImageCache(): Promise<void> {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch {
      // ponytail: Cache API unavailable (older VIDAA) — images aren't cached anyway.
    }
  },
  /** Drop fully-watched progress entries (position >= duration*0.9) so they leave
   *  Continue Watching. Mirrors Android "Ricalcola libreria" intent. */
  async recalcLibrary(): Promise<number> {
    const all = await db.progress.toArray();
    const done = all.filter((e) => e.durationSeconds > 0 && e.positionSeconds >= e.durationSeconds * 0.9);
    if (done.length) {
      await db.progress.bulkDelete(done.map((e) => [e.tmdbId, e.mediaType, e.season, e.episode] as [number, string, number, number]));
    }
    return done.length;
  },
};
