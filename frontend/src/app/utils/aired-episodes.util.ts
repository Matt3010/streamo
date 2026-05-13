import type { TmdbItem, TmdbEpisodeRef } from '../models';

/**
 * Returns the effective "last aired episode" considering next_episode_to_air
 * if its air_date is today or in the past.
 */
export function getEffectiveLastEpisode(item: TmdbItem): TmdbEpisodeRef | null {
  const nea = item.next_episode_to_air;
  if (nea?.air_date && !isFutureDate(nea.air_date)) {
    return nea;
  }
  return item.last_episode_to_air ?? null;
}

/**
 * Calculates the number of aired episodes considering next_episode_to_air
 * if its air_date is today or in the past.
 */
export function getAiredEpisodesCount(item: TmdbItem): number {
  const lastEp = getEffectiveLastEpisode(item);
  if (!lastEp || lastEp.season_number === undefined || lastEp.episode_number === undefined) {
    return item.number_of_episodes ?? 0;
  }

  let count = 0;
  for (const season of item.seasons ?? []) {
    if (season.season_number === 0) continue;
    if (season.season_number < lastEp.season_number) {
      count += season.episode_count ?? 0;
    } else if (season.season_number === lastEp.season_number) {
      count += lastEp.episode_number;
    }
  }
  return count;
}

function isFutureDate(dateStr: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) return false;
  const [, y, m, d] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return date.getTime() > today.getTime();
}
