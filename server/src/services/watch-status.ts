import { formatNewEpisodesMessage } from '../../../shared/release-format';
import {
  getAiredEpisodesCount,
  getBaseAiredEpisodesCount,
  type TmdbTvSummary
} from './tmdb-cache';

/** "Mancano N min" / "Manca 1 min" / "Mancano X h Y min" copy for the
 *  movie/Continua-a-guardare meta line. Returns undefined when the movie
 *  hasn't been started or has already been finished. */
export function formatMovieRemaining(
  position: number | undefined,
  duration: number | undefined
): string | undefined {
  const pos = position ?? 0;
  const dur = duration ?? 0;
  if (dur <= 0 || pos <= 0 || pos >= dur) return undefined;

  const remainingMinutes = Math.ceil((dur - pos) / 60);
  if (remainingMinutes <= 0) return undefined;
  if (remainingMinutes < 60) {
    return remainingMinutes === 1 ? 'Manca 1 min' : `Mancano ${remainingMinutes} min`;
  }

  const hours = Math.floor(remainingMinutes / 60);
  const minutes = remainingMinutes % 60;
  const timeLeft = minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
  return hours === 1 && minutes === 0 ? `Manca ${timeLeft}` : `Mancano ${timeLeft}`;
}

/** TV "what's the user's status" copy used both by /user/watchlist and
 *  /user/progress. `remaining` is the count of unwatched aired episodes
 *  from the user's perspective; `newEpisodes` is the TMDB-only diff
 *  (aired vs last_episode_to_air) — used only as a trigger to switch
 *  between "Nuovo episodio!" wording and the plain "Mancano N episodi"
 *  copy. The actual displayed count is always `remaining`, so e.g. a
 *  user 2 episodes behind with 1 newly-aired today sees "2 nuovi
 *  episodi!" (not "Nuovo episodio!" capped at the daily delta). */
export function formatTvStatusText(
  tmdb: TmdbTvSummary | null,
  watchedCount: number,
  doneAiredEpisodes: number,
  caughtUp: boolean
): string | undefined {
  const airedEpisodes = getAiredEpisodesCount(tmdb);
  const baseAiredEpisodes = getBaseAiredEpisodesCount(tmdb);

  if (airedEpisodes <= 0) return undefined;

  const watchedBaseline = Math.max(watchedCount, doneAiredEpisodes);
  const remaining = Math.max(0, airedEpisodes - watchedBaseline);

  const newEpisodes = Math.max(0, airedEpisodes - baseAiredEpisodes);
  if (newEpisodes > 0 && remaining > 0) {
    return formatNewEpisodesMessage(remaining);
  }

  if (caughtUp) return 'Sei al passo';

  if (watchedBaseline <= 0) return undefined;

  if (remaining === 0) return 'Sei al passo';
  return remaining === 1 ? 'Manca 1 episodio' : `Mancano ${remaining} episodi`;
}
