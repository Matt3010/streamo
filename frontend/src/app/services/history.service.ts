import { Injectable } from '@angular/core';
import type { MediaType, HistoryItem } from '../models';

@Injectable({ providedIn: 'root' })
export class HistoryService {
  async list(filters?: { media_type?: MediaType }): Promise<HistoryItem[]> {
    try {
      const qs = new URLSearchParams();
      if (filters?.media_type) qs.set('media_type', filters.media_type);
      const url = qs.size ? `/api/user/history?${qs.toString()}` : '/api/user/history';
      const res = await fetch(url);
      if (!res.ok) return [];
      const data = await res.json() as { items: HistoryItem[] };
      return data.items ?? [];
    } catch {
      return [];
    }
  }

  async save(tmdbId: number | string, type: MediaType, season: number, episode: number, title: string, poster: string | null): Promise<void> {
    try {
      await fetch('/api/user/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tmdb_id: tmdbId, media_type: type, season, episode, title, poster })
      });
    } catch {}
  }

  async clear(): Promise<void> {
    await fetch('/api/user/history', { method: 'DELETE' });
  }

  async remove(tmdbId: number | string, type: MediaType, season?: number, episode?: number): Promise<void> {
    const qs = new URLSearchParams();
    if (typeof season === 'number') qs.set('season', String(season));
    if (typeof episode === 'number') qs.set('episode', String(episode));
    const suffix = qs.size ? `?${qs.toString()}` : '';
    await fetch(`/api/user/history/${type}/${tmdbId}${suffix}`, { method: 'DELETE' });
  }
}
