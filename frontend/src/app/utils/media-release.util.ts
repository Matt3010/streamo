import type { MediaType, TmdbItem } from '../models';
import { getEffectiveLastEpisode, getAiredEpisodesCount, getBaseAiredEpisodesCount } from './aired-episodes.util';
import { parseDateOnly, isFutureDate, formatDateLong, formatDateShort } from './date.util';
import {
  formatNewEpisodesMessage,
  formatNextEpisodeDate,
  getEpisodesBefore,
  getWatchlistReleaseMeta
} from '../../../../shared/release-format';

export interface ReleaseStatusOptions {
  /**
   * When true, the "Nuovo episodio!" branch is skipped — the
   * helper falls through to next-season / ended / empty. Callers set this
   * when they know the user has already watched the freshly-aired episode
   * (so the "new" badge would be misleading).
   */
  suppressNewEpisode?: boolean;
}

export function getFullReleaseStatusText(item: TmdbItem, type: MediaType, options?: ReleaseStatusOptions): string {
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
    // Today or past — only show "new episode" when the caller hasn't told
    // us the user already watched it.
    if (!options?.suppressNewEpisode) {
      const newCount = countNewEpisodes(item);
      const base = formatNewEpisodesMessage(newCount);
      return newCount <= 1 ? `${base} S${season} E${episode}` : base;
    }
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

  const nextEpisode = item.next_episode_to_air;
  const nextEpisodeDate = parseDateOnly(nextEpisode?.air_date);
  if (nextEpisode && nextEpisodeDate) {
    const futureMsg = formatNextEpisodeDate(nextEpisode?.air_date);
    if (futureMsg) return futureMsg;
    // Today or past - show as new with correct plural
    return formatNewEpisodesMessage(countNewEpisodes(item));
  }

  const nextSeason = findNextSeason(item);
  if (nextSeason) {
    return `Stagione ${nextSeason.season} il ${formatDateShort(nextSeason.date)}`;
  }

  return '';
}

/** Same as getCompactReleaseStatusText but the "new episodes" count is
 *  derived from the user's resume position. Two boundary cases to handle:
 *    - position/duration > 0 with position near `duration`: the player saved
 *      a finite progress that rounds to ~100% (float imprecision in either
 *      the player or what TMDB reports as runtime). The episode is in fact
 *      done, but the server's strict `position >= duration` check failed to
 *      auto-advance the row, so we still see (S5 E7) instead of (S5 E8).
 *      Treat the episode as finished and count from `episode + 1`.
 *    - position == 0 (advanced row) or partway: `episode` itself hasn't
 *      been completed yet, count from `episode` so it shows up as "new".
 *  Falls back to the TMDB-only count when no resume info is available. */
export function getResumeAwareReleaseStatusText(
  item: TmdbItem,
  type: MediaType,
  resumeSeason: number | undefined,
  resumeEpisode: number | undefined,
  position?: number,
  duration?: number
): string {
  if (type !== 'tv' || !resumeSeason || !resumeEpisode) {
    return getCompactReleaseStatusText(item, type);
  }

  const watchlistRelease = getWatchlistReleaseMeta(item, type);
  if (watchlistRelease.text) return watchlistRelease.text;

  const nextEpisode = item.next_episode_to_air;
  const nextEpisodeDate = parseDateOnly(nextEpisode?.air_date);
  if (nextEpisode && nextEpisodeDate) {
    const futureMsg = formatNextEpisodeDate(nextEpisode?.air_date);
    if (futureMsg) return futureMsg;

    const effectivelyFinished =
      typeof duration === 'number' && duration > 0
      && typeof position === 'number' && position >= duration * 0.95;
    const aired = getAiredEpisodesCount(item);
    // Finished current → watched line includes `resumeEpisode`.
    // Otherwise → watched line stops at `resumeEpisode - 1` (server-advanced
    // rows with position=duration=0 land here, since they conceptually point
    // to the next-to-watch episode).
    const watched = getEpisodesBefore(
      item,
      resumeSeason,
      effectivelyFinished ? resumeEpisode + 1 : resumeEpisode
    );
    const unwatched = Math.max(0, aired - watched);
    return formatNewEpisodesMessage(unwatched);
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

function countNewEpisodes(item: TmdbItem): number {
  return Math.max(0, getAiredEpisodesCount(item) - getBaseAiredEpisodesCount(item));
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
