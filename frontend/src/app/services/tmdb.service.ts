import { Injectable } from '@angular/core';
import type { MediaType, TmdbItem, TmdbReview, TmdbSeasonDetails } from '../models';
import { apiGetJson } from '../utils/api.util';

const TMDB_BASE = '/api/tmdb';
const CACHE_MAX = 100;
const SEARCH_CACHE_MAX = 20;

@Injectable({ providedIn: 'root' })
export class TmdbService {
  private cache = new Map<string, TmdbItem>();
  private searchCache = new Map<string, TmdbItem[]>();

  async getDetails(tmdbId: string | number, type: MediaType): Promise<TmdbItem | null> {
    const key = `${type}-${tmdbId}`;
    const cached = this.cacheGet(key);
    if (cached) return cached;

    const data = await apiGetJson<TmdbItem>(`${TMDB_BASE}/${type}/${tmdbId}?language=it-IT&append_to_response=credits,videos`);
    if (data) this.cacheSet(key, data);
    return data;
  }

  async getSeasonDetails(tvId: number, seasonNumber: number): Promise<TmdbSeasonDetails | null> {
    return apiGetJson<TmdbSeasonDetails>(`${TMDB_BASE}/tv/${tvId}/season/${seasonNumber}?language=it-IT`);
  }

  async getRecommendations(tmdbId: string | number, type: MediaType): Promise<TmdbItem[]> {
    const data = await apiGetJson<{ results?: TmdbItem[] }>(`${TMDB_BASE}/${type}/${tmdbId}/recommendations?language=it-IT`);
    return data?.results ?? [];
  }

  async getReviews(tmdbId: string | number, type: MediaType): Promise<TmdbReview[]> {
    const urls = [
      `${TMDB_BASE}/${type}/${tmdbId}/reviews?language=it-IT`,
      `${TMDB_BASE}/${type}/${tmdbId}/reviews`,
      `${TMDB_BASE}/${type}/${tmdbId}/reviews?language=en-US`
    ];

    for (const url of urls) {
      const data = await apiGetJson<{ results?: TmdbReview[] }>(url);
      const reviews = data?.results ?? [];
      if (reviews.length > 0) return reviews;
    }
    return [];
  }

  async list(endpoint: string): Promise<TmdbItem[]> {
    const data = await apiGetJson<{ results?: TmdbItem[] }>(`${TMDB_BASE}${endpoint}?language=it-IT&region=IT`);
    return sortByNewest(data?.results ?? []);
  }

  async searchAll(query: string, signal?: AbortSignal): Promise<TmdbItem[]> {
    const key = query.toLowerCase().trim();
    if (!key) return [];

    const cached = this.searchCacheGet(key);
    if (cached) return cached;

    const data = await apiGetJson<{ results?: TmdbItem[] }>(
      `${TMDB_BASE}/search/multi?query=${encodeURIComponent(query)}&language=it-IT`,
      { signal }
    );
    if (!data) return [];
    const filtered = sortByNewest(
      (data.results ?? []).filter((item): item is TmdbItem & { media_type: MediaType } =>
        item.media_type === 'movie' || item.media_type === 'tv'
      )
    );
    this.searchCacheSet(key, filtered);
    return filtered;
  }

  private searchCacheGet(key: string): TmdbItem[] | undefined {
    const v = this.searchCache.get(key);
    if (v !== undefined) {
      this.searchCache.delete(key);
      this.searchCache.set(key, v);
    }
    return v;
  }

  private searchCacheSet(key: string, value: TmdbItem[]): void {
    if (this.searchCache.has(key)) {
      this.searchCache.delete(key);
    } else if (this.searchCache.size >= SEARCH_CACHE_MAX) {
      const firstKey = this.searchCache.keys().next().value;
      if (firstKey !== undefined) this.searchCache.delete(firstKey);
    }
    this.searchCache.set(key, value);
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
