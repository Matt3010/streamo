// Port of HomeSections.all — the fixed Home rails. Each section maps to a
// TMDB list endpoint paged by SectionRow. Italian titles from strings.
// `icon` is the Material Icons filled path data (24px viewBox), matching
// HomeSection.icon in HomeSection.kt (Icons.Filled.*). Rendered by
// ImmersiveRow as a 30px primary badge + 16px icon, like Android SectionHeader.
import { strings } from '../i18n/strings';

export interface HomeSection {
  title: string;
  endpoint: string;
  mediaType: 'movie' | 'tv';
  icon: string;
}

export const homeSections: HomeSection[] = [
  {
    title: strings.trendingMovies,
    endpoint: 'trending/movie/day',
    mediaType: 'movie',
    // ponytail: local_fire_department has two subpaths (flame outline + body);
    // joined into one `d` — SVG allows multiple subpaths in a single path data.
    icon:
      'M12 12.9l-2.13 2.09c-.56.56-.87 1.29-.87 2.07C9 18.68 10.35 20 12 20s3-1.32 3-2.94c0-.78-.31-1.52-.87-2.07L12 12.9z M16 6l-.44.55C14.38 8.02 12 7.19 12 5.3V2S4 6 4 13c0 2.92 1.56 5.47 3.89 6.86c-.56-.79-.89-1.76-.89-2.8c0-1.32.52-2.56 1.47-3.5L12 10.1l3.53 3.47c.95.93 1.47 2.17 1.47 3.5c0 1.02-.31 1.96-.85 2.75c1.89-1.15 3.29-3.06 3.71-5.3c.66-3.55-1.07-6.9-3.86-8.52z'
  },
  {
    title: strings.nowPlaying,
    endpoint: 'movie/now_playing',
    mediaType: 'movie',
    icon: 'M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z'
  },
  {
    title: strings.onTheAir,
    endpoint: 'tv/on_the_air',
    mediaType: 'tv',
    icon: 'M21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h5v2h8v-2h5c1.1 0 1.99-.9 1.99-2L23 5c0-1.1-.9-2-2-2zm0 14H3V5h18v12z'
  },
  {
    title: strings.popularMovies,
    endpoint: 'movie/popular',
    mediaType: 'movie',
    icon: 'M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5s5 2.24 5 5s-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3s3-1.34 3-3s-1.34-3-3-3z'
  },
  {
    title: strings.popularTv,
    endpoint: 'tv/popular',
    mediaType: 'tv',
    icon: 'M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5s5 2.24 5 5s-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3s3-1.34 3-3s-1.34-3-3-3z'
  },
  {
    title: strings.upcoming,
    endpoint: 'movie/upcoming',
    mediaType: 'movie',
    icon: 'M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10zM9 14H7v-2h2v2zm4 0h-2v-2h2v2zm4 0h-2v-2h2v2zm-8 4H7v-2h2v2zm4 0h-2v-2h2v2zm4 0h-2v-2h2v2z'
  },
  {
    title: strings.topRatedTv,
    endpoint: 'tv/top_rated',
    mediaType: 'tv',
    icon: 'M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2L9.19 8.63L2 9.24l5.46 4.73L5.82 21z'
  },
  {
    title: strings.airingToday,
    endpoint: 'tv/airing_today',
    mediaType: 'tv',
    icon: 'M3.24 6.15C2.51 6.43 2 7.17 2 8v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8c0-1.11-.89-2-2-2H8.3l8.26-3.34L15.88 1L3.24 6.15zM7 20c-1.66 0-3-1.34-3-3s1.34-3 3-3s3 1.34 3 3s-1.34 3-3 3zm13-8h-2v-2h-2v2H4V8h16v4z'
  }
];

// Icons for the non-TMDB home rows (Continue watching / La mia lista), same
// Material filled glyphs Android uses (PlayCircle / Bookmark).
export const SECTION_ICONS = {
  continueWatching: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10s10-4.48 10-10S17.52 2 12 2zM9.5 16.5v-9l7 4.5l-7 4.5z',
  myList: 'M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2z',
  history:
    'M13 3a9 9 0 0 0-9 9H1l3.96 3.96L9 21v-3a9 9 0 0 0 9-9c0-4.97-4.03-9-9-9zm1 5v5l4.25 2.52.77-1.28-3.52-2.09V8H14z',
};