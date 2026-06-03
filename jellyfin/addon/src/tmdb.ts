// TMDB lookup — translates the external ids Gelato/AIOStreams speak (imdb
// `tt…`, `tmdb:…`) into a title + canonical tmdb id we can search on SC and
// then verify against SC's own `tmdb_id` field. The `sc:` namespace (direct
// Stremio use) never touches this module.

import { type MediaType, fetchWithTimeout } from './util.js';

const TMDB_API_KEY = (process.env.TMDB_API_KEY || '').trim();
const TMDB_LANGUAGE = (process.env.TMDB_LANGUAGE || 'it-IT').trim();
const TIMEOUT_MS = 8000;

export function tmdbEnabled(): boolean {
  return Boolean(TMDB_API_KEY);
}

export type ExternalId =
  | { kind: 'imdb'; id: string }
  | { kind: 'tmdb'; id: number };

export type TmdbTitle = {
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  originalTitle: string | null;
  year: number | null;
};

/// Resolves an imdb/tmdb id to a canonical title for SC search + verification.
export async function lookupTitle(external: ExternalId, mediaType: MediaType): Promise<TmdbTitle | null> {
  if (!TMDB_API_KEY) {
    return null;
  }

  if (external.kind === 'imdb') {
    const data = await tmdbGet<{
      movie_results?: Array<Record<string, unknown>>;
      tv_results?: Array<Record<string, unknown>>;
    }>(`/find/${external.id}`, { external_source: 'imdb_id' });
    const entry = mediaType === 'movie' ? data?.movie_results?.[0] : data?.tv_results?.[0];
    return entry ? toTitle(entry, mediaType) : null;
  }

  const path = mediaType === 'movie' ? `/movie/${external.id}` : `/tv/${external.id}`;
  const entry = await tmdbGet<Record<string, unknown>>(path, {});
  return entry && typeof entry.id === 'number' ? toTitle(entry, mediaType) : null;
}

function toTitle(entry: Record<string, unknown>, mediaType: MediaType): TmdbTitle | null {
  const tmdbId = typeof entry.id === 'number' ? entry.id : null;
  const title = stringOf(mediaType === 'movie' ? entry.title : entry.name);
  if (!tmdbId || !title) {
    return null;
  }
  const date = stringOf(mediaType === 'movie' ? entry.release_date : entry.first_air_date);
  return {
    tmdbId,
    mediaType,
    title,
    originalTitle: stringOf(mediaType === 'movie' ? entry.original_title : entry.original_name),
    year: date ? Number.parseInt(date.slice(0, 4), 10) || null : null
  };
}

async function tmdbGet<T>(path: string, params: Record<string, string>): Promise<T | null> {
  const url = new URL(`https://api.themoviedb.org/3${path}`);
  url.searchParams.set('api_key', TMDB_API_KEY);
  url.searchParams.set('language', TMDB_LANGUAGE);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const response = await fetchWithTimeout(url, {}, TIMEOUT_MS).catch(() => null);
  if (!response?.ok) {
    return null;
  }
  return response.json().catch(() => null) as Promise<T | null>;
}

function stringOf(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
