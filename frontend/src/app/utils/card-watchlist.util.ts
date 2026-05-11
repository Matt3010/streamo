import type { WritableSignal } from '@angular/core';
import type { CardItem } from '../models';
import type { WatchlistService } from '../services/watchlist.service';
import type { CardPendingAction } from '../models';

export interface WatchlistToggleResult {
  inWatchlist: boolean;
  message: string;
}

export function isSameCard(a: CardItem, b: CardItem): boolean {
  return a.tmdb_id === b.tmdb_id && a.media_type === b.media_type;
}

export function applyWatchlistFlags(
  items: CardItem[],
  entries: ReadonlyArray<{ media_type: string; tmdb_id: number }>
): CardItem[] {
  const ids = new Set(entries.map((entry) => `${entry.media_type}:${entry.tmdb_id}`));
  return items.map((item) => ({
    ...item,
    inWatchlist: ids.has(`${item.media_type}:${item.tmdb_id}`)
  }));
}

export function setCardWatchlistFlag(items: CardItem[], target: CardItem, next: boolean): CardItem[] {
  return items.map((candidate) => (
    isSameCard(candidate, target) ? { ...candidate, inWatchlist: next } : candidate
  ));
}

export function setCardPendingAction(
  items: CardItem[],
  target: CardItem,
  next: CardPendingAction | null
): CardItem[] {
  return items.map((candidate) => (
    isSameCard(candidate, target)
      ? { ...candidate, pendingAction: next ?? undefined }
      : candidate
  ));
}

export async function runCardMutation<T>(
  items: WritableSignal<CardItem[]>,
  target: CardItem,
  action: CardPendingAction,
  task: () => Promise<T>
): Promise<T | undefined> {
  const snapshot = items();
  const current = snapshot.find((candidate) => isSameCard(candidate, target));
  if (current?.pendingAction) return undefined;

  items.update((entries) => setCardPendingAction(entries, target, action));
  try {
    return await task();
  } finally {
    items.update((entries) => setCardPendingAction(entries, target, null));
  }
}

export async function toggleCardWatchlist(
  item: CardItem,
  watchlist: WatchlistService
): Promise<WatchlistToggleResult> {
  if (item.inWatchlist) {
    await watchlist.remove(item.tmdb_id, item.media_type);
    return { inWatchlist: false, message: `${item.title}: rimosso dalla lista` };
  }

  await watchlist.add(item.tmdb_id, item.media_type, item.title, item.poster);
  return { inWatchlist: true, message: `${item.title}: aggiunto alla lista` };
}
