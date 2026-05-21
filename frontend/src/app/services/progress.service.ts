import { Injectable } from '@angular/core';
import { signal } from '@angular/core';
import type { MediaType, ProgressItem } from '../models';
import { apiGetJson, apiOk, jsonRequest } from '../utils/api.util';

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
  readonly tick = signal(0);

  async list(): Promise<ProgressItem[]> {
    const data = await apiGetJson<{ items: ProgressItem[] }>('/api/user/progress');
    return data?.items ?? [];
  }

  async get(tmdbId: string | number, type: MediaType, season = 0, episode = 0): Promise<{ position: number; duration: number } | null> {
    let url = `/api/user/progress/${type}/${tmdbId}`;
    if (type === 'tv') url += `/${season}/${episode}`;
    const data = await apiGetJson<{ progress: { position: number; duration: number } | null }>(url);
    return data?.progress ?? null;
  }

  /** All per-episode progress rows for a TV series in one round-trip. Used
   * by the watch page to render progress bars on every episode card. */
  async getSeriesProgress(tmdbId: string | number): Promise<Array<{ season: number; episode: number; position: number; duration: number }>> {
    const data = await apiGetJson<{ items: Array<{ season: number; episode: number; position: number; duration: number }> }>(`/api/user/progress/series/${tmdbId}`);
    return data?.items ?? [];
  }

  /** Next unwatched episode for a TV show, or null if none / not started. */
  async getNextUnwatched(tmdbId: string | number, type: MediaType): Promise<{ season: number; episode: number } | null> {
    if (type !== 'tv') return null;
    const data = await apiGetJson<{ next: { season: number; episode: number } | null }>(`/api/user/progress/next/${type}/${tmdbId}`);
    return data?.next ?? null;
  }

  /** Fire-and-forget save called every ~15s while watching. Tolerant to
   *  network blips because the next save overwrites; not worth surfacing
   *  per-attempt failures. */
  async save(payload: ProgressPayload): Promise<void> {
    const ok = await apiOk('/api/user/progress', jsonRequest('POST', payload));
    if (ok) this.tick.update((n) => n + 1);
  }

  /** User-initiated "rimuovi da Continua a guardare". Returns false if
   *  the request didn't succeed so the caller can show an error toast
   *  instead of letting the title silently linger. */
  async hideTitle(tmdbId: string | number, type: MediaType): Promise<boolean> {
    const ok = await apiOk(`/api/user/progress/title/${type}/${tmdbId}`, jsonRequest('DELETE'));
    if (ok) this.tick.update((n) => n + 1);
    return ok;
  }

  /** User-initiated "rimuovi questo progresso". Same contract as
   *  hideTitle — return value lets the caller surface the error. */
  async remove(tmdbId: string | number, type: MediaType, season = 0, episode = 0): Promise<boolean> {
    let url = `/api/user/progress/${type}/${tmdbId}`;
    if (type === 'tv') url += `/${season}/${episode}`;
    const ok = await apiOk(url, jsonRequest('DELETE'));
    if (ok) this.tick.update((n) => n + 1);
    return ok;
  }
}
