// Verbatim port of TMDBImage.kt.

const BASE = 'https://image.tmdb.org/t/p/';

export enum TmdbImageSize {
  W92 = 'w92',
  W154 = 'w154',
  W185 = 'w185',
  W300 = 'w300',
  W342 = 'w342',
  W500 = 'w500',
  W780 = 'w780',
  W1280 = 'w1280',
  ORIGINAL = 'original',
}

export const TMDBImage = {
  url(path: string | null | undefined, size: TmdbImageSize = TmdbImageSize.W500): string | null {
    if (!path || path.trim().length === 0) return null;
    if (/^https?:\/\//i.test(path)) return path;
    return `${BASE}${size}${path}`;
  },
};
