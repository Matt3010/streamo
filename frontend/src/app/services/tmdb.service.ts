import { Injectable } from '@angular/core';
import type { MediaType, TmdbItem, TmdbSeasonDetails } from '../models';

const TMDB_BASE = '/api/tmdb';
const CACHE_MAX = 100;

@Injectable({ providedIn: 'root' })
export class TmdbService {
  private cache = new Map<string, TmdbItem>();

  async getDetails(tmdbId: string | number, type: MediaType): Promise<TmdbItem | null> {
    const key = `${type}-${tmdbId}`;
    const cached = this.cacheGet(key);
    if (cached) return cached;

    const res = await fetch(`${TMDB_BASE}/${type}/${tmdbId}?language=it-IT&append_to_response=credits`);
    if (!res.ok) return null;
    const data = await res.json() as TmdbItem;
    this.cacheSet(key, data);
    return data;
  }

  async getSeasonDetails(tvId: number, seasonNumber: number): Promise<TmdbSeasonDetails | null> {
    const res = await fetch(`${TMDB_BASE}/tv/${tvId}/season/${seasonNumber}?language=it-IT`);
    if (!res.ok) return null;
    return res.json() as Promise<TmdbSeasonDetails>;
  }

  async getRecommendations(tmdbId: string | number, type: MediaType): Promise<TmdbItem[]> {
    try {
      const res = await fetch(`${TMDB_BASE}/${type}/${tmdbId}/recommendations?language=it-IT`);
      if (!res.ok) return [];
      const data = await res.json() as { results?: TmdbItem[] };
      return data.results ?? [];
    } catch {
      return [];
    }
  }

  async list(endpoint: string): Promise<TmdbItem[]> {
    try {
      const res = await fetch(`${TMDB_BASE}${endpoint}?language=it-IT&region=IT`);
      const data = await res.json() as { results?: TmdbItem[] };
      return sortByNewest(data.results ?? []);
    } catch {
      return [];
    }
  }

  async searchAll(query: string): Promise<TmdbItem[]> {
    try {
      const res = await fetch(`${TMDB_BASE}/search/multi?query=${encodeURIComponent(query)}&language=it-IT`);
      const data = await res.json() as { results?: TmdbItem[] };
      const results = data.results ?? [];
      return sortByNewest(
        results.filter((item): item is TmdbItem & { media_type: MediaType } => item.media_type === 'movie' || item.media_type === 'tv')
      );
    } catch {
      return [];
    }
  }

  private cacheGet(key: string): TmdbItem | undefined {
    const v = this.cache.get(key);
    if (v !== undefined) {
      this.cache.delete(key);
      this.cache.set(key, v);
    }
    return v;
  }

  private cacheSet(key: string, value: TmdbItem): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= CACHE_MAX) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }
}

function sortByNewest<T extends TmdbItem>(items: T[]): T[] {
  return [...items].sort((a, b) => newestTimestamp(b) - newestTimestamp(a));
}

function newestTimestamp(item: TmdbItem): number {
  const raw = item.release_date ?? item.first_air_date ?? '';
  if (!raw) return 0;
  const ts = Date.parse(raw);
  return Number.isFinite(ts) ? ts : 0;
}
