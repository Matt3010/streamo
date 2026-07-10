// TMDB DTOs — TypeScript mirror of TmdbModels.kt.
// Field names are snake_case to match the JSON payload (the Android client
// uses Gson with snake_case naming, so the wire fields are snake_case).
// Optionality matches the Kotlin data classes (nullable = `T | null`,
// non-nullable = `T`). Computed helpers (displayTitle/primaryDate/year) are
// preserved as functions rather than getters.

export interface TmdbGenre {
  id: number;
  name: string;
}

export interface TmdbCastMember {
  id: number;
  name: string;
  character: string | null;
  order: number | null;
  profile_path: string | null;
}

export interface TmdbCredits {
  cast: TmdbCastMember[] | null;
}

export interface TmdbVideo {
  id: string;
  key: string | null;
  name: string | null;
  site: string | null;
  type: string | null;
  official: boolean | null;
  published_at: string | null;
}

export interface TmdbVideoCollection {
  results: TmdbVideo[] | null;
}

export interface TmdbEpisodeRef {
  season_number: number | null;
  episode_number: number | null;
  air_date: string | null;
}

export interface TmdbSeasonInfo {
  season_number: number;
  episode_count: number | null;
  name: string | null;
  air_date: string | null;
}

export interface TmdbEpisodeDetail {
  episode_number: number;
  season_number: number | null;
  name: string | null;
  overview: string | null;
  still_path: string | null;
  air_date: string | null;
  runtime: number | null;
}

export interface TmdbSeasonDetails {
  episodes: TmdbEpisodeDetail[] | null;
}

export interface TmdbReviewAuthorDetails {
  username: string | null;
  name: string | null;
  avatar_path: string | null;
  rating: number | null;
}

export interface TmdbReview {
  id: string;
  author: string;
  content: string;
  created_at: string | null;
  updated_at: string | null;
  url: string | null;
  author_details: TmdbReviewAuthorDetails | null;
}

export interface TmdbGenreListResponse {
  genres: TmdbGenre[];
}

/** Polymorphic movie/tv item. `media_type` disambiguates when present. */
export interface TmdbItem {
  id: number;
  media_type: string | null;
  title: string | null;
  name: string | null;
  poster_path: string | null;
  backdrop_path: string | null;
  popularity: number | null;
  vote_average: number | null;
  vote_count: number | null;
  release_date: string | null;
  first_air_date: string | null;
  overview: string | null;
  tagline: string | null;
  runtime: number | null;
  episode_run_time: number[] | null;
  number_of_seasons: number | null;
  number_of_episodes: number | null;
  status: string | null;
  genres: TmdbGenre[] | null;
  credits: TmdbCredits | null;
  videos: TmdbVideoCollection | null;
  seasons: TmdbSeasonInfo[] | null;
  last_episode_to_air: TmdbEpisodeRef | null;
  genre_ids: number[] | null;
  next_episode_to_air: TmdbEpisodeRef | null;
}

export interface TmdbListResponse<T> {
  results: T[] | null;
}

// --- Computed helpers (mirror TmdbItem getters in Kotlin) ---

export function displayTitle(item: TmdbItem): string {
  return item.title ?? item.name ?? '';
}

export function primaryDate(item: TmdbItem): string | null {
  return item.release_date ?? item.first_air_date;
}

export function itemYear(item: TmdbItem): number | null {
  const raw = primaryDate(item);
  if (!raw || raw.length < 4) return null;
  const n = Number.parseInt(raw.slice(0, 4), 10);
  return Number.isNaN(n) ? null : n;
}