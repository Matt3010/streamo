import { Injectable } from '@angular/core';
import type { MediaType, ProgressItem } from '../models';

interface ProgressPayload {
  tmdb_id: number;
  media_type: MediaType;
  season: number;
  episode: number;
  position: number;
  duration: number;
  title: string | null;
  poster: string | null;
  backdrop: string | null;
}

@Injectable({ providedIn: 'root' })
export class ProgressService {
  async list(): Promise<ProgressItem[]> {
    try {
      const res = await fetch('/api/user/progress');
      if (!res.ok) return [];
      const data = await res.json() as { items: ProgressItem[] };
      return data.items ?? [];
    } catch {
      return [];
    }
  }

  async get(tmdbId: string | number, type: MediaType, season = 0, episode = 0): Promise<{ position: number; duration: number } | null> {
    try {
      let url = `/api/user/progress/${type}/${tmdbId}`;
      if (type === 'tv') url += `/${season}/${episode}`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json() as { progress: { position: number; duration: number } | null };
      return data.progress;
    } catch {
      return null;
    }
  }

  /** All per-episode progress rows for a TV series in one round-trip. Used
   * by the watch page to render progress bars on every episode card. */
  async getSeriesProgress(tmdbId: string | number): Promise<Array<{ season: number; episode: number; position: number; duration: number }>> {
    try {
      const res = await fetch(`/api/user/progress/series/${tmdbId}`);
      if (!res.ok) return [];
      const data = await res.json() as { items: Array<{ season: number; episode: number; position: number; duration: number }> };
      return data.items ?? [];
    } catch {
      return [];
    }
  }

  /** Next unwatched episode for a TV show, or null if none / not started. */
  async getNextUnwatched(tmdbId: string | number, type: MediaType): Promise<{ season: number; episode: number } | null> {
    if (type !== 'tv') return null;
    try {
      const res = await fetch(`/api/user/progress/next/${type}/${tmdbId}`);
      if (!res.ok) return null;
      const data = await res.json() as { next: { season: number; episode: number } | null };
      return data.next;
    } catch {
      return null;
    }
  }

  async save(payload: ProgressPayload): Promise<void> {
    try {
      await fetch('/api/user/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch {}
  }
}
