// Pure formatting and counting helpers shared by both frontend (Angular) and
// backend (Express). No runtime dependencies, no framework imports — only
// standard Intl/Date so the module is safe to import from either side.

// --- Structural types compatible with both TmdbItem (frontend) and
// TmdbTvSummary (backend). Only the fields used by the helpers below.

export interface TvLikeEpisodeRef {
  season_number?: number;
  episode_number?: number;
  air_date?: string | null;
}

export interface TvLikeSeasonInfo {
  season_number: number;
  episode_count?: number;
}

export interface TvLike {
  number_of_episodes?: number;
  seasons?: ReadonlyArray<TvLikeSeasonInfo>;
  last_episode_to_air?: TvLikeEpisodeRef | null;
  next_episode_to_air?: TvLikeEpisodeRef | null;
}

export interface ReleaseStatusLike {
  release_date?: string | null;
  first_air_date?: string | null;
  next_episode_to_air?: TvLikeEpisodeRef | null;
}

// --- Date helpers (string-based, since TMDB returns YYYY-MM-DD strings) ---

/** Checks if a YYYY-MM-DD date string is strictly after today (local time). */
export function isFutureDateStr(dateStr: string | null | undefined): boolean {
  if (!dateStr) return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) return false;
  const [, y, m, d] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return date.getTime() > today.getTime();
}

/** Formats a YYYY-MM-DD date string as Italian short (e.g., "25 giu"). */
export function formatDateShortIt(dateStr: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) return dateStr;
  const [, y, m, d] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  return new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short' }).format(date);
}

/** Formats a YYYY-MM-DD date string as Italian long (e.g., "25 giugno 2026"). */
export function formatDateLongIt(dateStr: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) return dateStr;
  const [, y, m, d] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  return new Intl.DateTimeFormat('it-IT', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format(date);
}

// --- Episode counting ---

function countEpisodesUpTo(tv: TvLike | null | undefined, ref: TvLikeEpisodeRef | null | undefined): number {
  if (!tv) return 0;
  if (!ref || typeof ref.season_number !== 'number' || typeof ref.episode_number !== 'number') {
    return tv.number_of_episodes ?? 0;
  }
  let count = 0;
  for (const season of tv.seasons ?? []) {
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
 * Counts aired episodes, treating next_episode_to_air as already aired when
 * its air_date is today or in the past.
 */
export function getAiredEpisodesCount(tv: TvLike | null | undefined): number {
  if (!tv) return 0;
  const nea = tv.next_episode_to_air;
  const neaHasAired = nea?.air_date ? !isFutureDateStr(nea.air_date) : false;
  const ref = neaHasAired && nea ? nea : tv.last_episode_to_air ?? null;
  return countEpisodesUpTo(tv, ref);
}

/** Counts aired episodes using only last_episode_to_air (TMDB's lagging value). */
export function getBaseAiredEpisodesCount(tv: TvLike | null | undefined): number {
  if (!tv) return 0;
  return countEpisodesUpTo(tv, tv.last_episode_to_air ?? null);
}

// --- Italian message formatters ---

/**
 * "Nuovo episodio!" / "N nuovi episodi!"
 * Count <= 1 returns the singular form.
 */
export function formatNewEpisodesMessage(count: number): string {
  return count <= 1
    ? 'Nuovo episodio!'
    : `${count} nuovi episodi!`;
}

/**
 * "Nuovo ep. 25 giu" for a future air date, otherwise undefined.
 */
export function formatNextEpisodeDate(dateStr: string | null | undefined): string | undefined {
  if (!dateStr || !isFutureDateStr(dateStr)) return undefined;
  return `Nuovo ep. ${formatDateShortIt(dateStr)}`;
}

/**
 * Shared watchlist release entrypoint.
 * - Marks unreleased movies/series from their title release date
 * - Emits the same compact future-episode copy used on cards
 */
export function getWatchlistReleaseMeta(
  item: ReleaseStatusLike | null | undefined,
  mediaType: 'movie' | 'tv'
): { isUpcoming: boolean; text?: string } {
  if (!item) return { isUpcoming: false };

  const titleDate = mediaType === 'movie' ? item.release_date : item.first_air_date;
  if (titleDate && isFutureDateStr(titleDate)) {
    return {
      isUpcoming: true,
      text: mediaType === 'movie'
        ? `Esce il ${formatDateLongIt(titleDate)}`
        : `Dal ${formatDateLongIt(titleDate)}`
    };
  }

  if (mediaType === 'tv') {
    const nextEpisodeText = formatNextEpisodeDate(item.next_episode_to_air?.air_date);
    if (nextEpisodeText) {
      return { isUpcoming: false, text: nextEpisodeText };
    }
  }

  return { isUpcoming: false };
}
