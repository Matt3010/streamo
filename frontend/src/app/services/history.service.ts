import { Injectable } from '@angular/core';
import type { MediaType, HistoryItem } from '../models';
import { apiGetJson, apiOk, jsonRequest } from '../utils/api.util';

@Injectable({ providedIn: 'root' })
export class HistoryService {
  async list(filters?: { media_type?: MediaType }): Promise<HistoryItem[]> {
    const qs = new URLSearchParams();
    if (filters?.media_type) qs.set('media_type', filters.media_type);
    const url = qs.size ? `/api/user/history?${qs.toString()}` : '/api/user/history';
    const data = await apiGetJson<{ items: HistoryItem[] }>(url);
    return data?.items ?? [];
  }

  /** Fire-and-forget — auto-record from the player when an episode is
   *  watched. A blip is fine because the next save overwrites and this
   *  isn't a user action with explicit feedback. */
  async save(tmdbId: number | string, type: MediaType, season: number, episode: number, title: string, poster: string | null): Promise<void> {
    await apiOk('/api/user/history', jsonRequest('POST', {
      tmdb_id: tmdbId, media_type: type, season, episode, title, poster
    }));
  }

  /** User-initiated. Return value lets the caller surface a network error. */
  async clear(): Promise<boolean> {
    return apiOk('/api/user/history', jsonRequest('DELETE'));
  }

  /** User-initiated. Return value lets the caller surface a network error. */
  async remove(tmdbId: number | string, type: MediaType, season?: number, episode?: number): Promise<boolean> {
    const qs = new URLSearchParams();
    if (typeof season === 'number') qs.set('season', String(season));
    if (typeof episode === 'number') qs.set('episode', String(episode));
    const suffix = qs.size ? `?${qs.toString()}` : '';
    return apiOk(`/api/user/history/${type}/${tmdbId}${suffix}`, jsonRequest('DELETE'));
  }
}
