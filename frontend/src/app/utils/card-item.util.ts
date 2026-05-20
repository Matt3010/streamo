import type { CardItem, HistoryItem, MediaType, TmdbItem, WatchlistItem } from '../models';
import type { TmdbService } from '../services/tmdb.service';
import { getCompactReleaseStatusText, getUpcomingBadgeText, isTitleUpcoming } from './media-release.util';

function enrichCardBase(item: CardItem, details: TmdbItem): CardItem {
  return {
    ...item,
    popularity: details.popularity,
    voteCount: details.vote_count,
    rating: item.rating ?? (details.vote_average ? details.vote_average.toFixed(1) : ''),
    year: item.year ?? (details.release_date ?? details.first_air_date ?? '').split('-')[0] ?? '',
    upcomingBadge: getUpcomingBadgeText(details, item.media_type)
  };
}

export function tmdbToCardItem(item: TmdbItem, type: MediaType, showReleaseText = false): CardItem {
  const dateStr = item.release_date ?? item.first_air_date ?? '';
  const upcoming = isTitleUpcoming(item, type);
  return {
    tmdb_id: item.id,
    media_type: type,
    title: item.title ?? item.name ?? 'Senza titolo',
    poster: item.poster_path ?? null,
    popularity: item.popularity,
    voteCount: item.vote_count,
    year: dateStr.split('-')[0] ?? '',
    rating: item.vote_average ? item.vote_average.toFixed(1) : '',
    isUpcoming: upcoming,
    upcomingBadge: getUpcomingBadgeText(item, type),
    nextReleaseText: showReleaseText ? getCompactReleaseStatusText(item, type) || undefined : undefined
  };
}

export function watchlistToCardItem(item: WatchlistItem): CardItem {
  return {
    tmdb_id: item.tmdb_id,
    media_type: item.media_type,
    title: item.title ?? 'Senza titolo',
    poster: item.poster,
    status: item.status ?? 'todo',
    folderName: item.folder_name ?? null,
    isUpcoming: item.is_upcoming,
    watchStatus: item.watch_status_text,
    nextReleaseText: item.next_release_text,
    season: item.resume_season,
    episode: item.resume_episode,
    position: item.position,
    duration: item.duration
  };
}

export function historyToCardItem(item: HistoryItem): CardItem {
  return {
    tmdb_id: item.tmdb_id,
    media_type: item.media_type,
    title: item.title ?? 'Senza titolo',
    poster: item.poster,
    season: item.season || undefined,
    episode: item.episode || undefined,
    position: item.position,
    duration: item.duration,
    watchedAt: item.watched_at,
    completed: item.completed,
    watchStatus: item.watch_status_text,
    nextReleaseText: item.resume_text,
    resumeSeason: item.resume_season,
    resumeEpisode: item.resume_episode
  };
}

/* Concurrency cap. Bigger lists (e.g. a 100-item watchlist) would otherwise
 * fire 100 parallel TMDB requests through the backend cache, hitting the
 * upstream limiter and spiking the event loop. 10-at-a-time is enough to
 * keep the row above the fold populated quickly without burst behavior. */
const ENRICH_CONCURRENCY = 10;

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function enrichTmdbCards(
  items: CardItem[],
  tmdb: TmdbService
): Promise<CardItem[]> {
  return mapWithConcurrency(items, ENRICH_CONCURRENCY, async (item) => {
    const details = await tmdb.getDetails(item.tmdb_id, item.media_type);
    if (!details) return item;
    const upcoming = isTitleUpcoming(details, item.media_type);
    return {
      ...enrichCardBase(item, details),
      isUpcoming: upcoming,
      nextReleaseText: getCompactReleaseStatusText(details, item.media_type) || undefined
    };
  });
}

export async function enrichLibraryCardsWithTmdb(
  items: CardItem[],
  tmdb: TmdbService
): Promise<CardItem[]> {
  return mapWithConcurrency(items, ENRICH_CONCURRENCY, async (item) => {
    const details = await tmdb.getDetails(item.tmdb_id, item.media_type);
    if (!details) return item;
    return enrichCardBase(item, details);
  });
}
