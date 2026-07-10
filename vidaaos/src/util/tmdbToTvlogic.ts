// Bridge from dto (snake_case TMDB JSON) to tvlogic's camelCase structural
// interfaces. tvlogic.ts was authored against camelCase shapes; TMDBClient
// returns snake_case dto.TmdbItem. This is the single adapter — every store
// that needs season/episode traversal goes through here.
import type {
  TmdbItem as DtoItem,
  TmdbSeasonInfo as DtoSeason,
  TmdbEpisodeDetail as DtoEpisode,
  TmdbEpisodeRef as DtoRef
} from '../data/tmdb/dto';
import type {
  TmdbItem,
  TmdbSeasonInfo,
  TmdbEpisodeDetail,
  TmdbEpisodeRef
} from './tvlogic';

export function toTvRef(r: DtoRef | null | undefined): TmdbEpisodeRef | null {
  if (!r) return null;
  return { seasonNumber: r.season_number, episodeNumber: r.episode_number, airDate: r.air_date };
}

export function toTvSeason(s: DtoSeason): TmdbSeasonInfo {
  return {
    seasonNumber: s.season_number,
    episodeCount: s.episode_count,
    name: s.name ?? null,
    airDate: s.air_date ?? null
  };
}

export function toTvItem(item: DtoItem): TmdbItem {
  return {
    id: item.id,
    mediaType: item.media_type,
    title: item.title,
    name: item.name,
    numberOfSeasons: item.number_of_seasons,
    numberOfEpisodes: item.number_of_episodes,
    seasons: (item.seasons ?? []).map(toTvSeason),
    lastEpisodeToAir: toTvRef(item.last_episode_to_air),
    nextEpisodeToAir: toTvRef(item.next_episode_to_air)
  };
}

export function toTvEpisode(e: DtoEpisode): TmdbEpisodeDetail {
  return {
    episodeNumber: e.episode_number,
    seasonNumber: e.season_number ?? null,
    name: e.name ?? null,
    overview: e.overview ?? null,
    stillPath: e.still_path ?? null,
    airDate: e.air_date ?? null,
    runtime: e.runtime ?? null
  };
}

export function toTvEpisodes(es: DtoEpisode[] | null | undefined): TmdbEpisodeDetail[] {
  return (es ?? []).map(toTvEpisode);
}