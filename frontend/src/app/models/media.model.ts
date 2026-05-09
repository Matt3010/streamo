// MediaType is shared with the backend; the rest of the TMDB shapes are
// frontend-only (only Angular consumes /api/tmdb directly).
export type { MediaType } from '../../../../shared/types';

export interface TmdbGenre {
  id: number;
  name: string;
}

export interface TmdbCastMember {
  id: number;
  name: string;
  character?: string;
  order?: number;
  profile_path?: string | null;
}

export interface TmdbCredits {
  cast?: TmdbCastMember[];
}

export interface TmdbItem {
  id: number;
  media_type?: 'movie' | 'tv' | 'person';
  title?: string;
  name?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  vote_average?: number;
  vote_count?: number;
  release_date?: string;
  first_air_date?: string;
  overview?: string;
  tagline?: string;
  runtime?: number;
  episode_run_time?: number[];
  number_of_seasons?: number;
  number_of_episodes?: number;
  genres?: TmdbGenre[];
  credits?: TmdbCredits;
  seasons?: TmdbSeasonInfo[];
  /** Latest episode that has already aired — used to compute "X usciti su Y". */
  last_episode_to_air?: TmdbEpisodeRef | null;
}

export interface TmdbEpisodeRef {
  season_number?: number;
  episode_number?: number;
  air_date?: string | null;
}

export interface TmdbSeasonInfo {
  season_number: number;
  episode_count?: number;
  air_date?: string | null;
}

export interface TmdbEpisodeDetail {
  episode_number: number;
  season_number?: number;
  name?: string;
  overview?: string;
  still_path?: string | null;
  air_date?: string | null;
  runtime?: number | null;
}

export interface TmdbSeasonDetails {
  episodes?: TmdbEpisodeDetail[];
}
