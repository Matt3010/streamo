// Route definitions mirroring Android NavRoutes (TV-relevant subset).
// Discriminated union; params travel as typed fields.

export type MediaType = 'movie' | 'tv' | 'anime';

export interface HomeRoute {
  name: 'home';
}
export interface SearchRoute {
  name: 'search';
}
export interface LibraryRoute {
  name: 'library';
}
export interface AnimeRoute {
  name: 'anime';
}
export interface AnimeDetailRoute {
  name: 'animeDetail';
  animeId: string;
  slug: string;
  title: string;
  poster?: string;
  type?: string;
  year?: string;
  status?: string;
  dub?: string;
  plot?: string;
}
export interface DetailRoute {
  name: 'detail';
  tmdbId: number;
  mediaType: MediaType;
  resumeSeason?: number;
  resumeEpisode?: number;
}
export interface SectionListRoute {
  name: 'sectionList';
  title: string;
  endpoint: string;
  mediaType: MediaType;
}
export interface SettingsRoute {
  name: 'settings';
}
export interface CacheManagementRoute {
  name: 'cacheManagement';
}
export interface PlayerRoute {
  name: 'player';
  tmdbId: number;
  mediaType: MediaType;
  resumeSeason?: number;
  resumeEpisode?: number;
  title?: string;
  poster?: string;
  releaseDate?: string;
  animeEpisodeId?: string;
  animeSlug?: string;
}

export type Route =
  | HomeRoute
  | SearchRoute
  | LibraryRoute
  | AnimeRoute
  | AnimeDetailRoute
  | DetailRoute
  | SectionListRoute
  | SettingsRoute
  | CacheManagementRoute
  | PlayerRoute;

export type RouteName = Route['name'];

// Serialize a route to a path.
export function routeToPath(r: Route): string {
  switch (r.name) {
    case 'home':
      return '/';
    case 'search':
      return '/search';
    case 'library':
      return '/library';
    case 'anime':
      return '/anime';
    case 'animeDetail':
      return `/anime/${r.animeId}/${encodeURIComponent(r.slug)}`;
    case 'detail':
      return `/detail/${r.mediaType}/${r.tmdbId}`;
    case 'sectionList':
      return `/section/${encodeURIComponent(r.endpoint)}/${r.mediaType}`;
    case 'settings':
      return '/settings';
    case 'cacheManagement':
      return '/settings/cache';
    case 'player': {
      // ponytail: encode season/episode for tv so next/prev-episode navigation
      // changes the path. Router.navigate no-ops when the path is unchanged, so
      // without this the skip button computed the right route but navigate did
      // nothing → the player never reloaded the next episode.
      const base = `/player/${r.mediaType}/${r.tmdbId}`;
      if (r.mediaType === 'anime' && r.animeEpisodeId != null) {
        return `${base}/${r.animeEpisodeId}`;
      }
      if (r.mediaType === 'tv' && r.resumeSeason != null && r.resumeEpisode != null) {
        return `${base}/${r.resumeSeason}/${r.resumeEpisode}`;
      }
      return base;
    }
  }
}

// Parse the current location into a route. Minimal — full param richness is
// passed via navigate() state for non-path-encodable fields.
export function pathToRoute(path: string): Route {
  const p = path.replace(/\/+$/, '');
  if (p === '' || p === '/') return { name: 'home' };
  const seg = p.split('/').filter(Boolean);
  switch (seg[0]) {
    case 'search':
      return { name: 'search' };
    case 'library':
      return { name: 'library' };
    case 'anime':
      if (seg.length >= 3)
        return {
          name: 'animeDetail',
          animeId: seg[1],
          slug: decodeURIComponent(seg[2]),
          title: ''
        };
      return { name: 'anime' };
    case 'detail':
      return { name: 'detail', mediaType: seg[1] as MediaType, tmdbId: Number(seg[2]) };
    case 'section':
      return {
        name: 'sectionList',
        title: '',
        endpoint: decodeURIComponent(seg[1]),
        mediaType: seg[2] as MediaType
      };
    case 'settings':
      if (seg[1] === 'cache') return { name: 'cacheManagement' };
      return { name: 'settings' };
    case 'player':
      return {
        name: 'player',
        mediaType: seg[1] as MediaType,
        tmdbId: Number(seg[2]),
        resumeSeason: seg[1] === 'tv' && seg.length >= 5 ? Number(seg[3]) : undefined,
        resumeEpisode: seg[1] === 'tv' && seg.length >= 5 ? Number(seg[4]) : undefined,
        animeEpisodeId: seg[1] === 'anime' && seg.length >= 4 ? seg[3] : undefined,
      };
    default:
      return { name: 'home' };
  }
}

// ponytail: self-check — next-episode path must differ from current (else
// Router.navigate no-ops) and round-trip through pathToRoute.
export function demo(): void {
  const cur = { name: 'player' as const, mediaType: 'tv' as const, tmdbId: 123, resumeSeason: 1, resumeEpisode: 3 };
  const nxt = { ...cur, resumeSeason: 2, resumeEpisode: 5 };
  const p1 = routeToPath(cur);
  const p2 = routeToPath(nxt);
  console.assert(p1 === '/player/tv/123/1/3', 'cur path', p1);
  console.assert(p2 === '/player/tv/123/2/5', 'next path differs (skip nav)', p2);
  console.assert(p1 !== p2, 'next-episode path must change');
  const back = pathToRoute(p2);
  console.assert(back.name === 'player' && back.tmdbId === 123 && back.resumeSeason === 2 && back.resumeEpisode === 5, 'round-trip', back);
  // movie: no season/episode encoded.
  console.assert(routeToPath({ name: 'player', mediaType: 'movie', tmdbId: 7 }) === '/player/movie/7', 'movie path');
  const anime = { name: 'player' as const, mediaType: 'anime' as const, tmdbId: 42, animeEpisodeId: '9001' };
  const animePath = routeToPath(anime);
  console.assert(animePath === '/player/anime/42/9001', 'anime episode path', animePath);
  const animeBack = pathToRoute(animePath);
  console.assert(animeBack.name === 'player' && animeBack.animeEpisodeId === '9001', 'anime path round-trip', animeBack);
  console.log('routes.ts demo: OK');
}

if (typeof process !== 'undefined' && process.argv[1]?.endsWith('routes.ts')) demo();
