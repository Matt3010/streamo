import { Injectable, signal } from '@angular/core';
import type { MediaType, WatchlistItem, WatchlistListStatusFilter, WatchlistStatus } from '../models';
import { apiGetJson, apiOk, jsonRequest } from '../utils/api.util';

@Injectable({ providedIn: 'root' })
export class WatchlistService {
  /** Bumped after any add/remove so dependent UIs (Home "La mia lista") refresh. */
  readonly tick = signal(0);

  notifyExternalUpdate(): void {
    this.tick.update(n => n + 1);
  }

  async list(filters?: { status?: WatchlistListStatusFilter; media_type?: MediaType }): Promise<WatchlistItem[]> {
    const qs = new URLSearchParams();
    if (filters?.status) qs.set('status', filters.status);
    if (filters?.media_type) qs.set('media_type', filters.media_type);
    const url = qs.size ? `/api/user/watchlist?${qs.toString()}` : '/api/user/watchlist';
    const data = await apiGetJson<{ items: WatchlistItem[] }>(url);
    return data?.items ?? [];
  }

  async check(tmdbId: number | string, type: MediaType): Promise<boolean> {
    const data = await apiGetJson<{ in_list: boolean }>(`/api/user/watchlist/check/${type}/${tmdbId}`);
    return data?.in_list ?? false;
  }

  /** All mutations return `true` only when the server confirmed the change
   *  (2xx response). Callers should treat `false` as a failure (HTTP error
   *  OR network error) and surface it to the user — typically by rolling
   *  back the optimistic UI update and showing an error toast. The tick
   *  signal is bumped only on success so dependent UIs don't redraw from
   *  a phantom state. */
  async add(tmdbId: number | string, type: MediaType, title: string, poster: string | null): Promise<boolean> {
    const ok = await apiOk('/api/user/watchlist', jsonRequest('POST', { tmdb_id: tmdbId, media_type: type, title, poster }));
    if (ok) this.notifyExternalUpdate();
    return ok;
  }

  async remove(tmdbId: number | string, type: MediaType): Promise<boolean> {
    const ok = await apiOk(`/api/user/watchlist/${type}/${tmdbId}`, jsonRequest('DELETE'));
    if (ok) this.notifyExternalUpdate();
    return ok;
  }

  async setStatus(tmdbId: number | string, type: MediaType, status: WatchlistStatus): Promise<boolean> {
    const ok = await apiOk(`/api/user/watchlist/${type}/${tmdbId}`, jsonRequest('PATCH', { status }));
    if (ok) this.notifyExternalUpdate();
    return ok;
  }

  async setFolder(tmdbId: number | string, type: MediaType, folderName: string | null): Promise<boolean> {
    const ok = await apiOk(`/api/user/watchlist/${type}/${tmdbId}`, jsonRequest('PATCH', { folder_name: folderName }));
    if (ok) this.notifyExternalUpdate();
    return ok;
  }
}
