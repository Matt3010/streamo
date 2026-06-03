// Bridges the external-id world (Gelato/AIOStreams: imdb `tt…`, `tmdb:…`) to
// an SC title. SC has no id-based lookup — only text search — so:
//   1. TMDB translates the external id to a title name + canonical tmdb id
//   2. we text-search SC by name
//   3. we open the top candidates and keep the one whose own `tmdb_id` matches
// Step 3 is the anti-mismatch guard: it disambiguates sequels/remakes that
// share a name (Matrix vs Matrix Reloaded) by exact id, never by fuzziness.
// A title+year fallback covers the rare SC entry with a missing tmdb_id.

import { type MediaType } from './util.js';
import { type TitleRef, searchCatalog, titleDetail } from './catalog.js';
import { type ExternalId, lookupTitle, tmdbEnabled } from './tmdb.js';

const MAX_CANDIDATES_PROBED = 6;
const CACHE_TTL_MS = 30 * 60 * 1000;

type CacheEntry = { value: TitleRef | null; expiresAt: number };
const cache = new Map<string, CacheEntry>();

export { tmdbEnabled };

/// Resolves an external id (imdb/tmdb) to an SC title reference, or null when
/// SC doesn't carry it (→ the caller returns an empty stream list).
export async function resolveExternalId(external: ExternalId, mediaType: MediaType): Promise<TitleRef | null> {
  const cacheKey = `${mediaType}:${external.kind}:${external.id}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const ref = await resolveUncached(external, mediaType);
  cache.set(cacheKey, { value: ref, expiresAt: Date.now() + CACHE_TTL_MS });
  return ref;
}

async function resolveUncached(external: ExternalId, mediaType: MediaType): Promise<TitleRef | null> {
  const tmdb = await lookupTitle(external, mediaType);
  if (!tmdb) {
    return null;
  }

  // Search by localized title first, then original — covers SC entries indexed
  // under either. Dedup queries.
  const queries = [tmdb.title, tmdb.originalTitle].filter(
    (value, index, all): value is string => Boolean(value) && all.indexOf(value) === index
  );

  const wantType = mediaType;
  let titleFallback: TitleRef | null = null;

  for (const query of queries) {
    const candidates = (await searchCatalog(query) ?? []).filter((entry) => entry.type === wantType);

    for (const candidate of candidates.slice(0, MAX_CANDIDATES_PROBED)) {
      const detail = await titleDetail(candidate.id, candidate.slug);
      if (!detail) {
        continue;
      }

      // Exact id match — the strong guard.
      if (detail.tmdbId === tmdb.tmdbId || (external.kind === 'imdb' && detail.imdbId === external.id)) {
        return { id: detail.id, slug: detail.slug };
      }

      // Remember a title+year match as a fallback for SC entries whose
      // tmdb_id is missing; only used if no exact match shows up at all.
      if (!titleFallback && detail.tmdbId == null && titleYearMatches(detail.name, detail.year, tmdb)) {
        titleFallback = { id: detail.id, slug: detail.slug };
      }
    }
  }

  return titleFallback;
}

function titleYearMatches(name: string, year: number | null, tmdb: { title: string; originalTitle: string | null; year: number | null }): boolean {
  const target = normalize(name);
  const sameTitle = target === normalize(tmdb.title)
    || (tmdb.originalTitle != null && target === normalize(tmdb.originalTitle));
  if (!sameTitle) {
    return false;
  }
  // Allow ±1 year slack (release vs SC's date can differ by region).
  return year == null || tmdb.year == null || Math.abs(year - tmdb.year) <= 1;
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}
