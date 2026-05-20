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
  lastTriggeredAt: number | null;
  nextAllowedAt: number;
  requiresConfirm: boolean;
  cooldownSeconds: number;
}

interface ProviderResolveResult<T> {
  resolved: T | null;
  reason: ProviderResolveFailureReason | null;
}

export interface ProviderResolvedTitleResult extends ProviderResolveResult<ProviderResolvedTitle> {
  manualRefresh: ProviderManualRefreshState;
}

const DEFAULT_MANUAL_REFRESH_COOLDOWN_SECONDS = 4 * 60 * 60;

function fallbackManualRefreshState(): ProviderManualRefreshState {
  return {
    lastTriggeredAt: null,
    nextAllowedAt: 0,
    requiresConfirm: false,
    cooldownSeconds: DEFAULT_MANUAL_REFRESH_COOLDOWN_SECONDS
  };
}

@Injectable({ providedIn: 'root' })
export class ProviderResolveService {
  private readonly titleCache = new Map<string, ProviderResolvedTitle | null>();
  private readonly episodeCache = new Map<string, ProviderResolvedEpisode | null>();
  private readonly movieCache = new Map<number, ProviderResolvedMovie | null>();

  async resolve(
    tmdbId: number,
    mediaType: MediaType,
    title: string,
    releaseDate?: string | null
  ): Promise<ProviderResolvedTitleResult> {
    const key = `${mediaType}:${tmdbId}`;
    if (this.titleCache.has(key)) {
      return {
        resolved: this.titleCache.get(key) ?? null,
        reason: null,
        manualRefresh: fallbackManualRefreshState()
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
        return {
          resolved: null,
          reason: 'temporarily_unavailable',
          manualRefresh: fallbackManualRefreshState()
        };
      }
      const data = await res.json() as ProviderResolvedTitleResult;
      const resolved = data.resolved ?? null;
      if (resolved) {
        this.titleCache.set(key, resolved);
      }
      return {
        resolved,
        reason: data.reason ?? null,
        manualRefresh: data.manualRefresh
      };
    } catch {
      return {
        resolved: null,
        reason: 'temporarily_unavailable',
        manualRefresh: fallbackManualRefreshState()
      };
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
        return {
          resolved: null,
          reason: 'temporarily_unavailable',
          manualRefresh: fallbackManualRefreshState()
        };
      }
      const data = await res.json() as ProviderResolvedTitleResult;
      const resolved = data.resolved ?? null;
      if (resolved) {
        this.titleCache.set(key, resolved);
      } else {
        this.titleCache.delete(key);
      }
      return {
        resolved,
        reason: data.reason ?? null,
        manualRefresh: data.manualRefresh
      };
    } catch {
      return {
        resolved: null,
        reason: 'temporarily_unavailable',
        manualRefresh: fallbackManualRefreshState()
      };
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
