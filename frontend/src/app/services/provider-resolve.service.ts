import { Injectable } from '@angular/core';
import type { MediaType } from '../models';

interface ProviderResolvedTitle {
  provider: 'streamingcommunity';
  id: number;
  slug: string | null;
  title: string;
  mediaType: MediaType;
}

interface ProviderResolvedEpisode {
  episodeId: number;
  embedUrl: string | null;
}

interface ProviderResolvedMovie {
  embedUrl: string | null;
}

type ProviderResolveFailureReason = 'not_found' | 'temporarily_unavailable';

export interface ProviderManualRefreshState {
  /** True after the user has clicked the manual refresh button at least
   * once for this title — drives the confirmation modal on subsequent
   * clicks. There's no rate limit. */
  requiresConfirm: boolean;
}

interface ProviderResolveResult<T> {
  resolved: T | null;
  reason: ProviderResolveFailureReason | null;
}

export interface ProviderResolvedTitleCandidate {
  providerTitleId: number;
  providerSlug: string | null;
  title: string;
  year: number | null;
  score: number;
  posterUrl: string | null;
}

export type ProviderMatchStatus = 'auto_confirmed' | 'manual_confirmed' | 'failed';

export interface ProviderResolvedTitleResult extends ProviderResolveResult<ProviderResolvedTitle> {
  manualRefresh: ProviderManualRefreshState;
  candidates: ProviderResolvedTitleCandidate[];
  matchStatus: ProviderMatchStatus | null;
}

function fallbackManualRefreshState(): ProviderManualRefreshState {
  return { requiresConfirm: false };
}

function fallbackTitleResult(
  reason: ProviderResolveFailureReason | null,
  resolved: ProviderResolvedTitle | null = null
): ProviderResolvedTitleResult {
  return {
    resolved,
    reason,
    manualRefresh: fallbackManualRefreshState(),
    candidates: [],
    matchStatus: null
  };
}

interface TitleCacheEntry {
  resolved: ProviderResolvedTitle | null;
  candidates: ProviderResolvedTitleCandidate[];
  matchStatus: ProviderMatchStatus | null;
}

@Injectable({ providedIn: 'root' })
export class ProviderResolveService {
  private readonly titleCache = new Map<string, TitleCacheEntry>();
  private readonly episodeCache = new Map<string, ProviderResolvedEpisode | null>();
  private readonly movieCache = new Map<number, ProviderResolvedMovie | null>();

  async resolve(
    tmdbId: number,
    mediaType: MediaType,
    title: string,
    releaseDate?: string | null
  ): Promise<ProviderResolvedTitleResult> {
    const key = `${mediaType}:${tmdbId}`;
    const cached = this.titleCache.get(key);
    if (cached) {
      return {
        resolved: cached.resolved,
        reason: cached.resolved ? null : 'not_found',
        manualRefresh: fallbackManualRefreshState(),
        candidates: cached.candidates,
        matchStatus: cached.matchStatus
      };
    }

    try {
      const res = await fetch('/api/user/provider/resolve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tmdb_id: tmdbId,
          media_type: mediaType,
          title,
          release_date: releaseDate ?? null
        })
      });
      if (!res.ok) {
        return fallbackTitleResult('temporarily_unavailable');
      }
      const data = await res.json() as ProviderResolvedTitleResult;
      this.cacheTitleEntry(key, data);
      return {
        resolved: data.resolved ?? null,
        reason: data.reason ?? null,
        manualRefresh: data.manualRefresh,
        candidates: data.candidates ?? [],
        matchStatus: data.matchStatus ?? null
      };
    } catch {
      return fallbackTitleResult('temporarily_unavailable');
    }
  }

  private cacheTitleEntry(key: string, data: ProviderResolvedTitleResult): void {
    // Only cache successful resolutions; null/failed results stay uncached so
    // a fresh navigation re-attempts. Candidates ride along so the picker has
    // them available without a re-fetch.
    if (data.resolved) {
      this.titleCache.set(key, {
        resolved: data.resolved,
        candidates: data.candidates ?? [],
        matchStatus: data.matchStatus ?? null
      });
    }
  }

  async refreshResolve(
    tmdbId: number,
    mediaType: MediaType,
    title: string,
    releaseDate?: string | null
  ): Promise<ProviderResolvedTitleResult> {
    const key = `${mediaType}:${tmdbId}`;

    try {
      const res = await fetch('/api/user/provider/refresh-resolve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tmdb_id: tmdbId,
          media_type: mediaType,
          title,
          release_date: releaseDate ?? null
        })
      });
      if (!res.ok) {
        return fallbackTitleResult('temporarily_unavailable');
      }
      const data = await res.json() as ProviderResolvedTitleResult;
      if (data.resolved) {
        this.cacheTitleEntry(key, data);
      } else {
        this.titleCache.delete(key);
      }
      return {
        resolved: data.resolved ?? null,
        reason: data.reason ?? null,
        manualRefresh: data.manualRefresh,
        candidates: data.candidates ?? [],
        matchStatus: data.matchStatus ?? null
      };
    } catch {
      return fallbackTitleResult('temporarily_unavailable');
    }
  }

  async manualConfirm(
    tmdbId: number,
    mediaType: MediaType,
    providerTitleId: number
  ): Promise<ProviderResolvedTitleResult> {
    const key = `${mediaType}:${tmdbId}`;
    try {
      const res = await fetch('/api/user/provider/manual-confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tmdb_id: tmdbId,
          media_type: mediaType,
          provider_title_id: providerTitleId
        })
      });
      if (!res.ok) {
        return fallbackTitleResult('temporarily_unavailable');
      }
      const data = await res.json() as ProviderResolvedTitleResult;
      if (data.resolved) {
        this.cacheTitleEntry(key, data);
      } else {
        this.titleCache.delete(key);
      }
      return {
        resolved: data.resolved ?? null,
        reason: data.reason ?? null,
        manualRefresh: data.manualRefresh,
        candidates: data.candidates ?? [],
        matchStatus: data.matchStatus ?? null
      };
    } catch {
      return fallbackTitleResult('temporarily_unavailable');
    }
  }

  async resolveEpisode(
    providerTitleId: number,
    providerSlug: string | null,
    season: number,
    episode: number
  ): Promise<ProviderResolveResult<ProviderResolvedEpisode>> {
    const slug = providerSlug?.trim() || null;
    const key = `${providerTitleId}:${slug ?? '-'}:${season}:${episode}`;
    if (this.episodeCache.has(key)) {
      return {
        resolved: this.episodeCache.get(key) ?? null,
        reason: null
      };
    }

    try {
      const res = await fetch('/api/user/provider/resolve-episode', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider_title_id: providerTitleId,
          provider_slug: slug,
          season,
          episode
        })
      });
      if (!res.ok) {
        return { resolved: null, reason: 'temporarily_unavailable' };
      }
      const data = await res.json() as ProviderResolveResult<ProviderResolvedEpisode>;
      const resolved = data.resolved ?? null;
      if (resolved) {
        this.episodeCache.set(key, resolved);
      }
      return {
        resolved,
        reason: data.reason ?? null
      };
    } catch {
      return { resolved: null, reason: 'temporarily_unavailable' };
    }
  }

  async resolveMovie(providerTitleId: number): Promise<ProviderResolveResult<ProviderResolvedMovie>> {
    if (this.movieCache.has(providerTitleId)) {
      return {
        resolved: this.movieCache.get(providerTitleId) ?? null,
        reason: null
      };
    }

    try {
      const res = await fetch('/api/user/provider/resolve-movie', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider_title_id: providerTitleId
        })
      });
      if (!res.ok) {
        return { resolved: null, reason: 'temporarily_unavailable' };
      }
      const data = await res.json() as ProviderResolveResult<ProviderResolvedMovie>;
      const resolved = data.resolved ?? null;
      if (resolved) {
        this.movieCache.set(providerTitleId, resolved);
      }
      return {
        resolved,
        reason: data.reason ?? null
      };
    } catch {
      return { resolved: null, reason: 'temporarily_unavailable' };
    }
  }
}
