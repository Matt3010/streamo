import type { TmdbItem, TmdbEpisodeRef } from '../models';
import { isFutureDateStr } from './date.util';

/**
 * Returns the effective "last aired episode" considering next_episode_to_air
 * if its air_date is today or in the past.
 */
export function getEffectiveLastEpisode(item: TmdbItem): TmdbEpisodeRef | null {
  const nea = item.next_episode_to_air;
  if (nea?.air_date && !isFutureDateStr(nea.air_date)) {
    return nea;
  }
  return item.last_episode_to_air ?? null;
}

/**
 * Counts episodes up to (and including) a given episode reference.
 */
export function countEpisodesUpTo(item: TmdbItem, ref: TmdbEpisodeRef | null): number {
  if (!ref || ref.season_number === undefined || ref.episode_number === undefined) {
    return item.number_of_episodes ?? 0;
  }

  let count = 0;
  for (const season of item.seasons ?? []) {
    if (season.season_number === 0) continue;
    if (season.season_number < ref.season_number) {
      count += season.episode_count ?? 0;
    } else if (season.season_number === ref.season_number) {
      count += ref.episode_number;
    }
  }
  return count;
}

/**
 * Calculates the number of aired episodes considering next_episode_to_air
 * if its air_date is today or in the past.
 */
export function getAiredEpisodesCount(item: TmdbItem): number {
  return countEpisodesUpTo(item, getEffectiveLastEpisode(item));
}

/**
 * Calculates the number of aired episodes using only last_episode_to_air.
 */
export function getBaseAiredEpisodesCount(item: TmdbItem): number {
  return countEpisodesUpTo(item, item.last_episode_to_air ?? null);
}
