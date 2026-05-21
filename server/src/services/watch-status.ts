import { formatNewEpisodesMessage, getEpisodesBefore } from '../../../shared/release-format';
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

export interface TvWatchStatus {
  /** User-facing copy for the card meta line. */
  text?: string;
  /** True iff `text` announces freshly-aired unwatched episodes
   *  ("Nuovo episodio!" / "N nuovi episodi!"). Lets the UI hide the
   *  progress bar (which would refer to the previously-finished episode
   *  and be misleading) without doing fragile string matching. */
  hasNewAired: boolean;
}

/** TV "what's the user's status" copy used both by /user/watchlist and
 *  /user/progress. The displayed count is always `remaining` (aired minus
 *  watched baseline); `newEpisodes` (TMDB-only delta) only flips the
 *  wording between "Nuovo episodio!" and "Mancano N episodi".
 *
 *  `resume` is the user's next-to-watch coordinate (post-advancement). When
 *  passed, every episode strictly before it is treated as watched — this
 *  rescues linear watchers whose per-episode progress rows are sparse
 *  (e.g. only saved the latest episode, watched the rest elsewhere). The
 *  max(watchedCount, doneAiredEpisodes, impliedFromResume) never undercounts
 *  and never overcounts a non-linear watcher whose actual watchedCount is
 *  already higher than the implied floor. */
export function formatTvStatusText(
  tmdb: TmdbTvSummary | null,
  watchedCount: number,
  doneAiredEpisodes: number,
  caughtUp: boolean,
  resume?: { season: number; episode: number } | null
): TvWatchStatus {
  const airedEpisodes = getAiredEpisodesCount(tmdb);
  const baseAiredEpisodes = getBaseAiredEpisodesCount(tmdb);

  if (airedEpisodes <= 0) return { hasNewAired: false };

  const impliedWatched = resume ? getEpisodesBefore(tmdb, resume.season, resume.episode) : 0;
  const watchedBaseline = Math.max(watchedCount, doneAiredEpisodes, impliedWatched);
  const remaining = Math.max(0, airedEpisodes - watchedBaseline);

  const newEpisodes = Math.max(0, airedEpisodes - baseAiredEpisodes);
  if (newEpisodes > 0 && remaining > 0) {
    return { text: formatNewEpisodesMessage(remaining), hasNewAired: true };
  }

  if (caughtUp) return { text: 'Sei al passo', hasNewAired: false };

  if (watchedBaseline <= 0) return { hasNewAired: false };

  if (remaining === 0) return { text: 'Sei al passo', hasNewAired: false };
  const text = remaining === 1 ? 'Manca 1 episodio' : `Mancano ${remaining} episodi`;
  return { text, hasNewAired: false };
}
