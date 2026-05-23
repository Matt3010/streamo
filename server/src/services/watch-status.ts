import { getEpisodesBefore } from '../../../shared/release-format';
import { getAiredEpisodesCount, type TmdbTvSummary } from './tmdb-cache';

function formatTvCaughtUpText(tmdb: TmdbTvSummary | null): string {
  return tmdb?.status === 'Ended' || tmdb?.status === 'Canceled'
    ? 'Serie conclusa'
    : 'Sei al passo';
}

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
 *  /user/progress. Counts unwatched aired episodes from the user's resume
 *  point and renders them as "Manca/Mancano N episodi" (or "Sei al passo"
 *  when fully caught up). The "Nuovo episodio!"/"N nuovi episodi!" variant
 *  intentionally isn't emitted here — it conflated "what's new today" with
 *  "what's pending for me" and confused users. The plain backlog count is
 *  the actionable signal.
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
): string | undefined {
  const airedEpisodes = getAiredEpisodesCount(tmdb);

  if (airedEpisodes <= 0) return undefined;

  const impliedWatched = resume ? getEpisodesBefore(tmdb, resume.season, resume.episode) : 0;
  const watchedBaseline = Math.max(watchedCount, doneAiredEpisodes, impliedWatched);
  const remaining = Math.max(0, airedEpisodes - watchedBaseline);

  if (caughtUp) return formatTvCaughtUpText(tmdb);
  if (watchedBaseline <= 0) return undefined;
  if (remaining === 0) return formatTvCaughtUpText(tmdb);
  return remaining === 1 ? 'Manca 1 episodio' : `Mancano ${remaining} episodi`;
}
