import { Injectable } from '@angular/core';
import type { ShareLink, ShareLinkStatus, SharedWatchlistResponse } from '../../../../shared/types';
import { apiGetJson, apiOk, apiSendJson, jsonRequest } from '../utils/api.util';

@Injectable({ providedIn: 'root' })
export class ShareLinksService {
  async list(): Promise<ShareLink[]> {
    const data = await apiGetJson<{ links?: ShareLink[] }>('/api/user/share-links');
    return data?.links ?? [];
  }

  async create(label: string | null): Promise<ShareLink | null> {
    return apiSendJson<ShareLink>('/api/user/share-links', jsonRequest('POST', { label }));
  }

  async update(id: number, patch: { status?: ShareLinkStatus; label?: string | null }): Promise<ShareLink | null> {
    return apiSendJson<ShareLink>(`/api/user/share-links/${id}`, jsonRequest('PATCH', patch));
  }

  async remove(id: number): Promise<boolean> {
    return apiOk(`/api/user/share-links/${id}`, jsonRequest('DELETE'));
  }

  /* Public read endpoint — no auth header. Returns null on 404
   * (unknown token OR suspended link, indistinguishable by design).
   * Pass `track: true` on the initial page open so the backend bumps
   * the visit counter; subsequent refetches triggered by the live
   * socket (data changed / connection blip) MUST omit it, otherwise
   * a single session inflates the count once per owner edit. */
  async fetchShared(token: string, opts?: { track?: boolean }): Promise<SharedWatchlistResponse | null> {
    const qs = opts?.track ? '?track=1' : '';
    return apiGetJson<SharedWatchlistResponse>(`/api/shared/${encodeURIComponent(token)}${qs}`);
  }
}
