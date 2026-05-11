import type { CardItem, MediaType, TmdbItem } from '../models';
import type { TmdbService } from '../services/tmdb.service';
import { getCompactReleaseStatusText, getUpcomingBadgeText, isTitleUpcoming } from './media-release.util';

type ReleaseTextMode = 'all' | 'upcoming-only' | 'none';

interface CardItemOptions {
  releaseTextMode?: ReleaseTextMode;
}

export function tmdbToCardItem(item: TmdbItem, type: MediaType, options: CardItemOptions = {}): CardItem {
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
    nextReleaseText: resolveReleaseText(item, type, upcoming, options.releaseTextMode ?? 'none')
  };
}

export async function enrichCardsWithTmdb(
  items: CardItem[],
  tmdb: TmdbService,
  options: CardItemOptions = {}
): Promise<CardItem[]> {
  return Promise.all(items.map(async (item) => {
    const details = await tmdb.getDetails(item.tmdb_id, item.media_type);
    if (!details) return item;
    const upcoming = isTitleUpcoming(details, item.media_type);
    return {
      ...item,
      popularity: details.popularity,
      voteCount: details.vote_count,
      rating: item.rating ?? (details.vote_average ? details.vote_average.toFixed(1) : ''),
      year: item.year ?? (details.release_date ?? details.first_air_date ?? '').split('-')[0] ?? '',
      isUpcoming: upcoming,
      upcomingBadge: getUpcomingBadgeText(details, item.media_type),
      nextReleaseText: resolveReleaseText(details, item.media_type, upcoming, options.releaseTextMode ?? 'all')
    };
  }));
}

function resolveReleaseText(
  item: TmdbItem,
  type: MediaType,
  upcoming: boolean,
  mode: ReleaseTextMode
): string | undefined {
  if (mode === 'none') return undefined;
  if (mode === 'upcoming-only' && !upcoming) return undefined;
  return getCompactReleaseStatusText(item, type) || undefined;
}
