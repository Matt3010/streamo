import type { WritableSignal } from '@angular/core';
import type { CardItem } from '../models';
import type { WatchlistService } from '../services/watchlist.service';
import type { CardPendingAction } from '../models';

export interface WatchlistToggleResult {
  ok: boolean;
  inWatchlist: boolean;
  message: string;
}

export type CardMatcher = (a: CardItem, b: CardItem) => boolean;

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
  next: CardPendingAction | null,
  matcher: CardMatcher = isSameCard
): CardItem[] {
  return items.map((candidate) => (
    matcher(candidate, target)
      ? { ...candidate, pendingAction: next ?? undefined }
      : candidate
  ));
}

export async function runCardMutation<T>(
  items: WritableSignal<CardItem[]>,
  target: CardItem,
  action: CardPendingAction,
  task: () => Promise<T>,
  matcher: CardMatcher = isSameCard
): Promise<T | undefined> {
  const snapshot = items();
  const current = snapshot.find((candidate) => matcher(candidate, target));
  if (current?.pendingAction) return undefined;

  items.update((entries) => setCardPendingAction(entries, target, action, matcher));
  try {
    return await task();
  } finally {
    items.update((entries) => setCardPendingAction(entries, target, null, matcher));
  }
}

export async function toggleCardWatchlist(
  item: CardItem,
  watchlist: WatchlistService
): Promise<WatchlistToggleResult> {
  if (item.inWatchlist) {
    const ok = await watchlist.remove(item.tmdb_id, item.media_type);
    return ok
      ? { ok: true, inWatchlist: false, message: `${item.title}: rimosso dalla lista` }
      : { ok: false, inWatchlist: true, message: 'Errore di rete, riprova' };
  }

  const ok = await watchlist.add(item.tmdb_id, item.media_type, item.title, item.poster);
  return ok
    ? { ok: true, inWatchlist: true, message: `${item.title}: aggiunto alla lista` }
    : { ok: false, inWatchlist: false, message: 'Errore di rete, riprova' };
}
