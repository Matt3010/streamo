import {
  faFire, faFilm, faEye, faStar, faCalendar, faTv, faSatelliteDish
} from '@fortawesome/free-solid-svg-icons';
import type { MediaType, SectionConfig } from '../../models';

export const SECTIONS: Record<MediaType, SectionConfig[]> = {
  movie: [
    { id: 'trending',     title: 'Di Tendenza', icon: faFire,     endpoint: '/trending/movie/day' },
    { id: 'now_playing',  title: 'Al Cinema',   icon: faFilm,     endpoint: '/movie/now_playing' },
    { id: 'popular',      title: 'Piu Visti',   icon: faEye,      endpoint: '/movie/popular' },
    { id: 'upcoming',     title: 'In Arrivo',   icon: faCalendar, endpoint: '/movie/upcoming' }
  ],
  tv: [
    { id: 'trending',     title: 'Di Tendenza', icon: faFire,          endpoint: '/trending/tv/day' },
    { id: 'on_the_air',   title: 'In Onda Ora', icon: faTv,            endpoint: '/tv/on_the_air' },
    { id: 'popular',      title: 'Piu Viste',   icon: faEye,           endpoint: '/tv/popular' },
    { id: 'top_rated',    title: 'Piu Votate',  icon: faStar,          endpoint: '/tv/top_rated' },
    { id: 'airing_today', title: 'Oggi in TV',  icon: faSatelliteDish, endpoint: '/tv/airing_today' }
  ]
};
