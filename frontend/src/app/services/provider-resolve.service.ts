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
  ): Promise<ProviderResolvedTitle | null> {
    const key = `${mediaType}:${tmdbId}`;
    if (this.titleCache.has(key)) {
      return this.titleCache.get(key) ?? null;
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
      if (!res.ok) return null;
      const data = await res.json() as { resolved?: ProviderResolvedTitle | null };
      const resolved = data.resolved ?? null;
      this.titleCache.set(key, resolved);
      return resolved;
    } catch {
      return null;
    }
  }

  async resolveEpisode(
    providerTitleId: number,
    providerSlug: string | null,
    season: number,
    episode: number
  ): Promise<ProviderResolvedEpisode | null> {
    const slug = providerSlug?.trim() || null;
    const key = `${providerTitleId}:${slug ?? '-'}:${season}:${episode}`;
    if (this.episodeCache.has(key)) {
      return this.episodeCache.get(key) ?? null;
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
      if (!res.ok) return null;
      const data = await res.json() as { resolved?: ProviderResolvedEpisode | null };
      const resolved = data.resolved ?? null;
      this.episodeCache.set(key, resolved);
      return resolved;
    } catch {
      return null;
    }
  }

  async resolveMovie(providerTitleId: number): Promise<ProviderResolvedMovie | null> {
    if (this.movieCache.has(providerTitleId)) {
      return this.movieCache.get(providerTitleId) ?? null;
    }

    try {
      const res = await fetch('/api/user/provider/resolve-movie', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider_title_id: providerTitleId
        })
      });
      if (!res.ok) return null;
      const data = await res.json() as { resolved?: ProviderResolvedMovie | null };
      const resolved = data.resolved ?? null;
      this.movieCache.set(providerTitleId, resolved);
      return resolved;
    } catch {
      return null;
    }
  }
}
