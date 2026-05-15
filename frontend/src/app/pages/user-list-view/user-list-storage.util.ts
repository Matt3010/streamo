import type { WatchlistListStatusFilter } from '../../models';

export type ViewMode = 'grid' | 'list';
export type MediaFilter = 'all' | 'tv' | 'movie';
export type BackendMediaFilter = Exclude<MediaFilter, 'all'>;

const VIEW_MODE_KEY = 'streamo.user-list.view-mode';
const MEDIA_FILTER_KEY = 'streamo.user-list.media-filter';
const STATUS_FILTER_KEY = 'streamo.user-list.status-filter';
const EXPANDED_FOLDERS_KEY = 'streamo.user-list.expanded-folders';

export function loadViewMode(): ViewMode {
  try {
    const v = localStorage.getItem(VIEW_MODE_KEY);
    return v === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
}

export function persistViewMode(mode: ViewMode): void {
  try { localStorage.setItem(VIEW_MODE_KEY, mode); } catch { /* storage unavailable */ }
}

export function loadMediaFilter(): MediaFilter {
  try {
    const value = localStorage.getItem(MEDIA_FILTER_KEY);
    return value === 'tv' || value === 'movie' ? value : 'all';
  } catch {
    return 'all';
  }
}

export function persistMediaFilter(filter: MediaFilter): void {
  try { localStorage.setItem(MEDIA_FILTER_KEY, filter); } catch { /* storage unavailable */ }
}

export function loadStatusFilter(): WatchlistListStatusFilter {
  try {
    const value = localStorage.getItem(STATUS_FILTER_KEY);
    if (value === 'unreleased') return 'unreleased';
    if (value === 'in_progress') return 'in_progress';
    if (value === 'done') return 'done';
    return 'todo';
  } catch {
    return 'todo';
  }
}

export function persistStatusFilter(filter: WatchlistListStatusFilter): void {
  try { localStorage.setItem(STATUS_FILTER_KEY, filter); } catch { /* storage unavailable */ }
}

export function loadExpandedFolders(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(EXPANDED_FOLDERS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

    return Object.fromEntries(
      Object.entries(parsed).filter(([key, value]) => typeof key === 'string' && value === true)
    ) as Record<string, boolean>;
  } catch {
    return {};
  }
}

export function persistExpandedFolders(state: Record<string, boolean>): void {
  try { localStorage.setItem(EXPANDED_FOLDERS_KEY, JSON.stringify(state)); } catch { /* storage unavailable */ }
}
