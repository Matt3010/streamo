import { Injectable } from '@angular/core';
import type { ShareLink, ShareLinkStatus, SharedWatchlistResponse } from '../../../../shared/types';

@Injectable({ providedIn: 'root' })
export class ShareLinksService {
  async list(): Promise<ShareLink[]> {
    try {
      const res = await fetch('/api/user/share-links');
      if (!res.ok) return [];
      const data = await res.json() as { links?: ShareLink[] };
      return data.links ?? [];
    } catch {
      return [];
    }
  }

  async create(label: string | null): Promise<ShareLink | null> {
    try {
      const res = await fetch('/api/user/share-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label })
      });
      if (!res.ok) return null;
      return await res.json() as ShareLink;
    } catch {
      return null;
    }
  }

  async update(id: number, patch: { status?: ShareLinkStatus; label?: string | null }): Promise<ShareLink | null> {
    try {
      const res = await fetch(`/api/user/share-links/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
      });
      if (!res.ok) return null;
      return await res.json() as ShareLink;
    } catch {
      return null;
    }
  }

  async remove(id: number): Promise<boolean> {
    try {
      const res = await fetch(`/api/user/share-links/${id}`, { method: 'DELETE' });
      return res.ok;
    } catch {
      return false;
    }
  }

  /* Public read endpoint — no auth header. Returns null on 404
   * (unknown token OR suspended link, indistinguishable by design).
   * Pass `track: true` on the initial page open so the backend bumps
   * the visit counter; subsequent refetches triggered by the live
   * socket (data changed / connection blip) MUST omit it, otherwise
   * a single session inflates the count once per owner edit. */
  async fetchShared(token: string, opts?: { track?: boolean }): Promise<SharedWatchlistResponse | null> {
    try {
      const qs = opts?.track ? '?track=1' : '';
      const res = await fetch(`/api/shared/${encodeURIComponent(token)}${qs}`);
      if (!res.ok) return null;
      return await res.json() as SharedWatchlistResponse;
    } catch {
      return null;
    }
  }
}
