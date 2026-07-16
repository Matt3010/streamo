// TMDB serves images at https://image.tmdb.org/t/p/<size><path> where
// <path> is the bare poster_path / backdrop_path / still_path returned
// by their API (e.g. "/abc123.jpg"). The base URL was hardcoded in
// ~6 different places with the size varying by use case — this helper
// keeps everything routed through a single typed entry point.

export type TmdbImageSize =
  | 'w92'    // bell thumb, list thumbs, search poster lookup
  | 'w300'   // episode stills
  | 'w342'   // card poster
  | 'w500'   // larger posters (not yet used but conventional)
  | 'w1280'  // hero backdrop
  | 'original';

// Keep artwork same-origin. Besides avoiding client-side DNS/content blocking
// of image.tmdb.org, this sends images through the same WARP-backed nginx
// egress path as the TMDB API.
const TMDB_IMAGE_HOST = '/tmdb-image';

/** Build a TMDB image URL. Returns an empty string when `path` is null/
 *  undefined/empty, so callers can bind it directly to `<img [src]>` and
 *  rely on the browser hiding the broken image. */
export function tmdbImageUrl(path: string | null | undefined, size: TmdbImageSize): string {
  if (!path) return '';
  // Some legacy callers store the full URL already — pass through.
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  // TMDB paths conventionally start with '/'; tolerate the rare case
  // where a caller stripped it.
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${TMDB_IMAGE_HOST}/${size}${normalized}`;
}
