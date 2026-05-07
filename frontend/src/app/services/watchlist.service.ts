import { Injectable, signal } from '@angular/core';
import type { MediaType, WatchlistItem, WatchlistStatus } from '../models';

@Injectable({ providedIn: 'root' })
export class WatchlistService {
  /** Bumped after any add/remove so dependent UIs (Home "La mia lista") refresh. */
  readonly tick = signal(0);

  async list(): Promise<WatchlistItem[]> {
    try {
      const res = await fetch('/api/user/watchlist');
      if (!res.ok) return [];
      const data = await res.json() as { items: WatchlistItem[] };
      return data.items ?? [];
    } catch {
      return [];
    }
  }

  async check(tmdbId: number | string, type: MediaType): Promise<boolean> {
    try {
      const res = await fetch(`/api/user/watchlist/check/${type}/${tmdbId}`);
      if (!res.ok) return false;
      const data = await res.json() as { in_list: boolean };
      return data.in_list;
    } catch {
      return false;
    }
  }

  async add(tmdbId: number | string, type: MediaType, title: string, poster: string | null): Promise<void> {
    await fetch('/api/user/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tmdb_id: tmdbId, media_type: type, title, poster })
    });
    this.tick.update(n => n + 1);
  }

  async remove(tmdbId: number | string, type: MediaType): Promise<void> {
    await fetch(`/api/user/watchlist/${type}/${tmdbId}`, { method: 'DELETE' });
    this.tick.update(n => n + 1);
  }

  async setStatus(tmdbId: number | string, type: MediaType, status: WatchlistStatus): Promise<void> {
    await fetch(`/api/user/watchlist/${type}/${tmdbId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    this.tick.update(n => n + 1);
  }

  /** Marks a TV show as watched up to and including (season, episode). */
  async markWatchedThrough(tmdbId: number | string, type: MediaType, season: number, episode: number): Promise<boolean> {
    const res = await fetch(`/api/user/watchlist/${type}/${tmdbId}/mark`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ season, episode })
    });
    if (!res.ok) return false;
    this.tick.update(n => n + 1);
    return true;
  }

  /** Marks a TV show as fully watched (all seasons + episodes) and flips status to 'done'. */
  async markWatchedAll(tmdbId: number | string, type: MediaType): Promise<boolean> {
    const res = await fetch(`/api/user/watchlist/${type}/${tmdbId}/mark`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all: true })
    });
    if (!res.ok) return false;
    this.tick.update(n => n + 1);
    return true;
  }
}
