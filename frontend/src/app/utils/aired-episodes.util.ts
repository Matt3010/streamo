import type { TmdbItem, TmdbEpisodeRef } from '../models';
import { isFutureDateStr } from './date.util';

export { getAiredEpisodesCount, getBaseAiredEpisodesCount } from '../../../../shared/release-format';

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
