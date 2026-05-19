import { Injectable } from '@angular/core';
import type { MediaType } from '../models';

interface ProviderResolvedTitle {
  provider: 'streamingcommunity';
  id: number;
  slug: string | null;
  title: string;
  mediaType: MediaType;
}

@Injectable({ providedIn: 'root' })
export class ProviderResolveService {
  private readonly cache = new Map<string, ProviderResolvedTitle | null>();

  async resolve(
    tmdbId: number,
    mediaType: MediaType,
    title: string,
    releaseDate?: string | null
  ): Promise<ProviderResolvedTitle | null> {
    const key = `${mediaType}:${tmdbId}`;
    if (this.cache.has(key)) {
      return this.cache.get(key) ?? null;
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
      this.cache.set(key, resolved);
      return resolved;
    } catch {
      return null;
    }
  }
}
