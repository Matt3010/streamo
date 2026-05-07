import { Injectable } from '@angular/core';
import type { MediaType, HistoryItem } from '../models';

@Injectable({ providedIn: 'root' })
export class HistoryService {
  async list(): Promise<HistoryItem[]> {
    try {
      const res = await fetch('/api/user/history');
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

  async remove(tmdbId: number | string, type: MediaType): Promise<void> {
    await fetch(`/api/user/history/${type}/${tmdbId}`, { method: 'DELETE' });
  }
}
