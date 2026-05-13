import type { MediaType, TmdbItem } from '../models';
import { getEffectiveLastEpisode, getAiredEpisodesCount, getBaseAiredEpisodesCount } from './aired-episodes.util';
import { parseDateOnly, isFutureDate, formatDateLong, formatDateShort } from './date.util';

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
  if (nextEpisode && nextEpisodeDate) {
    const season = nextEpisode.season_number ?? '?';
    const episode = nextEpisode.episode_number ?? '?';
    if (isFutureDate(nextEpisodeDate)) {
      return `Prossimo episodio: S${season} E${episode} in uscita il ${formatDateLong(nextEpisodeDate)}.`;
    }
    // Today or past - show as new with correct plural
    const newCount = countNewEpisodes(item);
    if (newCount <= 1) {
      return `È uscito un nuovo episodio! S${season} E${episode}`;
    }
    return `Sono usciti ${newCount} nuovi episodi!`;
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
  if (type === 'tv') {
    const firstAirDate = parseDateOnly(item.first_air_date);
    if (firstAirDate && isFutureDate(firstAirDate)) {
      return `Dal ${formatDateLong(firstAirDate)}`;
    }
  }

  if (type === 'movie') {
    const date = parseDateOnly(item.release_date);
    if (date && isFutureDate(date)) {
      return `Esce il ${formatDateLong(date)}`;
    }
    return '';
  }

  const nextEpisode = item.next_episode_to_air;
  const nextEpisodeDate = parseDateOnly(nextEpisode?.air_date);
  if (nextEpisode && nextEpisodeDate) {
    if (isFutureDate(nextEpisodeDate)) {
      return `Nuovo episodio ${formatDateShort(nextEpisodeDate)}`;
    }
    // Today or past - show as new with correct plural
    const newCount = countNewEpisodes(item);
    return formatNewEpisodesMessage(newCount);
  }

  const nextSeason = findNextSeason(item);
  if (nextSeason) {
    return `Stagione ${nextSeason.season} il ${formatDateShort(nextSeason.date)}`;
  }

  return '';
}

export function isTitleUpcoming(item: TmdbItem, type: MediaType): boolean {
  if (type === 'movie') {
    const date = parseDateOnly(item.release_date);
    return date !== null && isFutureDate(date);
  }

  const firstAirDate = parseDateOnly(item.first_air_date);
  return firstAirDate !== null && isFutureDate(firstAirDate);
}

export function getUpcomingBadgeText(item: TmdbItem, type: MediaType): string {
  if (!isTitleUpcoming(item, type)) return '';
  return type === 'movie' ? 'Prossimamente' : 'Nuova serie';
}

function countNewEpisodes(item: TmdbItem): number {
  return Math.max(0, getAiredEpisodesCount(item) - getBaseAiredEpisodesCount(item));
}

function formatNewEpisodesMessage(count: number): string {
  if (count <= 1) return 'È uscito un nuovo episodio!';
  return `Sono usciti ${count} nuovi episodi!`;
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
