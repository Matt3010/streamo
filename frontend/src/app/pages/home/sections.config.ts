import {
  faFire, faFilm, faEye, faStar, faCalendar, faTv, faSatelliteDish
} from '@fortawesome/free-solid-svg-icons';
import type { SectionConfig } from '../../models';

// Single flat list of rows shown on the unified home. Film and Serie TV are
// interleaved on purpose so the home doesn't need a Film/TV switcher — the
// title of each row makes the type explicit.
export const SECTIONS: SectionConfig[] = [
  { id: 'movie-trending',    mediaType: 'movie', title: 'Film di tendenza',     icon: faFire,          endpoint: '/trending/movie/day' },
  { id: 'tv-trending',       mediaType: 'tv',    title: 'Serie TV di tendenza', icon: faFire,          endpoint: '/trending/tv/day' },
  { id: 'movie-now_playing', mediaType: 'movie', title: 'Al cinema',            icon: faFilm,          endpoint: '/movie/now_playing' },
  { id: 'tv-on_the_air',     mediaType: 'tv',    title: 'Serie TV in onda',     icon: faTv,            endpoint: '/tv/on_the_air' },
  { id: 'movie-popular',     mediaType: 'movie', title: 'Film più visti',       icon: faEye,           endpoint: '/movie/popular' },
  { id: 'tv-popular',        mediaType: 'tv',    title: 'Serie TV più viste',   icon: faEye,           endpoint: '/tv/popular' },
  { id: 'movie-upcoming',    mediaType: 'movie', title: 'Film in arrivo',       icon: faCalendar,      endpoint: '/movie/upcoming' },
  { id: 'tv-top_rated',      mediaType: 'tv',    title: 'Serie TV più votate',  icon: faStar,          endpoint: '/tv/top_rated' },
  { id: 'tv-airing_today',   mediaType: 'tv',    title: 'Oggi in TV',           icon: faSatelliteDish, endpoint: '/tv/airing_today' }
];
