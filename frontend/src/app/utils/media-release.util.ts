import type { MediaType, TmdbItem } from '../models';
import { getEffectiveLastEpisode } from './aired-episodes.util';
import { parseDateOnly, isFutureDate, formatDateLong, formatDateShort } from './date.util';
import { getWatchlistReleaseMeta } from '../../../../shared/release-format';

export function getFullReleaseStatusText(item: TmdbItem, type: MediaType): string {
  if (type === 'tv') {
    const firstAirDate = parseDateOnly(item.first_air_date);
    if (firstAirDate && isFutureDate(firstAirDate)) {
      return `Nuova serie dal ${formatDateLong(firstAirDate)}.`;
    }
  }

  if (type === 'movie') {
    const date = parseDateOnly(item.release_date);
    if (date && isFutureDate(date)) {
      return `Esce il ${formatDateLong(date)}.`;
    }
    return '';
  }

  const nextEpisode = item.next_episode_to_air;
  const nextEpisodeDate = parseDateOnly(nextEpisode?.air_date);
  if (nextEpisode && nextEpisodeDate && isFutureDate(nextEpisodeDate)) {
    const season = nextEpisode.season_number ?? '?';
    const episode = nextEpisode.episode_number ?? '?';
    return `Prossimo episodio: S${season} E${episode} in uscita il ${formatDateLong(nextEpisodeDate)}.`;
  }

  const nextSeason = findNextSeason(item);
  if (nextSeason) {
    return `Prossima stagione: Stagione ${nextSeason.season} in uscita il ${formatDateLong(nextSeason.date)}.`;
  }

  if (item.status === 'Ended' || item.status === 'Canceled') {
    return 'Serie conclusa.';
  }

  return '';
}

export function getCompactReleaseStatusText(item: TmdbItem, type: MediaType): string {
  const watchlistRelease = getWatchlistReleaseMeta(item, type);
  if (watchlistRelease.text) {
    return watchlistRelease.text;
  }

  if (type === 'movie') {
    return '';
  }

  const nextSeason = findNextSeason(item);
  if (nextSeason) {
    return `Stagione ${nextSeason.season} il ${formatDateShort(nextSeason.date)}`;
  }

  return '';
}

export function isTitleUpcoming(item: TmdbItem, type: MediaType): boolean {
  return getWatchlistReleaseMeta(item, type).isUpcoming;
}

export function getUpcomingBadgeText(item: TmdbItem, type: MediaType): string {
  if (!isTitleUpcoming(item, type)) return '';
  return type === 'movie' ? 'Prossimamente' : 'Nuova serie';
}

function findNextSeason(item: TmdbItem): { season: number; date: Date } | null {
  const lastSeason = getEffectiveLastEpisode(item)?.season_number ?? 0;
  return (item.seasons ?? [])
    .filter((season) => season.season_number > 0)
    .map((season) => ({
      season: season.season_number,
      date: parseDateOnly(season.air_date)
    }))
    .filter((entry): entry is { season: number; date: Date } => entry.date !== null && entry.season > lastSeason)
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .find((entry) => isFutureDate(entry.date)) ?? null;
}
