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
   * (unknown token OR suspended link, indistinguishable by design). */
  async fetchShared(token: string): Promise<SharedWatchlistResponse | null> {
    try {
      const res = await fetch(`/api/shared/${encodeURIComponent(token)}`);
      if (!res.ok) return null;
      return await res.json() as SharedWatchlistResponse;
    } catch {
      return null;
    }
  }
}
