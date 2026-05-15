import type { CardItem } from '../../models';

export interface HistorySection {
  key: string;
  title: string;
  summary: string;
  items: CardItem[];
}

export function buildHistorySections(items: CardItem[]): HistorySection[] {
  const groups = new Map<string, HistorySection>();
  for (const item of items) {
    const watchedAt = item.watchedAt ?? 0;
    const key = historySectionKey(watchedAt);
    const existing = groups.get(key);
    if (existing) {
      existing.items.push(item);
      continue;
    }

    groups.set(key, {
      key,
      title: historySectionTitle(watchedAt),
      summary: '',
      items: [item]
    });
  }

  return Array.from(groups.values()).map((section) => ({
    ...section,
    summary: historySectionSummary(section.items)
  }));
}

export function isSameHistoryEntry(a: CardItem, b: CardItem): boolean {
  return a.tmdb_id === b.tmdb_id
    && a.media_type === b.media_type
    && (a.season ?? 0) === (b.season ?? 0)
    && (a.episode ?? 0) === (b.episode ?? 0);
}

function historySectionKey(tsSeconds: number): string {
  const now = new Date();
  const target = new Date(tsSeconds * 1000);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const date = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  const diffDays = Math.floor((today.getTime() - date.getTime()) / 86400000);

  if (diffDays <= 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return 'week';
  if (now.getFullYear() === target.getFullYear() && now.getMonth() === target.getMonth()) return 'month';
  return `older:${target.getFullYear()}-${target.getMonth()}`;
}

function historySectionTitle(tsSeconds: number): string {
  const key = historySectionKey(tsSeconds);
  if (key === 'today') return 'Oggi';
  if (key === 'yesterday') return 'Ieri';
  if (key === 'week') return 'Questa settimana';
  if (key === 'month') return 'Questo mese';
  return 'Prima';
}

function historySectionSummary(items: CardItem[]): string {
  const meaningfulItems = items.filter((item) => item.completed === true || (item.position ?? 0) > 10);
  const episodeCount = meaningfulItems.filter((item) => item.media_type === 'tv').length;
  const completedMovieCount = meaningfulItems.filter((item) => item.media_type === 'movie' && item.completed === true).length;
  const parts: string[] = [];
  if (episodeCount > 0) {
    parts.push(episodeCount === 1 ? '1 episodio visto' : `${episodeCount} episodi visti`);
  }
  if (completedMovieCount > 0) {
    parts.push(completedMovieCount === 1 ? '1 film completato' : `${completedMovieCount} film completati`);
  }
  return parts.join(' • ');
}
