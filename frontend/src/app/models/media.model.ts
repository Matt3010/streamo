export type MediaType = 'movie' | 'tv';

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
}

export interface TmdbSeasonInfo {
  season_number: number;
  episode_count?: number;
}

export interface TmdbSeasonDetails {
  episodes?: Array<{ episode_number: number }>;
}
