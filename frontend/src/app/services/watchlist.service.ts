import { Injectable, signal } from '@angular/core';
import type { MediaType, WatchlistItem, WatchlistListStatusFilter, WatchlistStatus } from '../models';

@Injectable({ providedIn: 'root' })
export class WatchlistService {
  /** Bumped after any add/remove so dependent UIs (Home "La mia lista") refresh. */
  readonly tick = signal(0);

  notifyExternalUpdate(): void {
    this.tick.update(n => n + 1);
  }

  async list(filters?: { status?: WatchlistListStatusFilter; media_type?: MediaType }): Promise<WatchlistItem[]> {
    try {
      const qs = new URLSearchParams();
      if (filters?.status) qs.set('status', filters.status);
      if (filters?.media_type) qs.set('media_type', filters.media_type);
      const url = qs.size ? `/api/user/watchlist?${qs.toString()}` : '/api/user/watchlist';
      const res = await fetch(url);
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
    this.notifyExternalUpdate();
  }

  async remove(tmdbId: number | string, type: MediaType): Promise<void> {
    await fetch(`/api/user/watchlist/${type}/${tmdbId}`, { method: 'DELETE' });
    this.notifyExternalUpdate();
  }

  async setStatus(tmdbId: number | string, type: MediaType, status: WatchlistStatus): Promise<void> {
    await fetch(`/api/user/watchlist/${type}/${tmdbId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    this.notifyExternalUpdate();
  }

  async setFolder(tmdbId: number | string, type: MediaType, folderName: string | null): Promise<void> {
    await fetch(`/api/user/watchlist/${type}/${tmdbId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder_name: folderName })
    });
  }
}
