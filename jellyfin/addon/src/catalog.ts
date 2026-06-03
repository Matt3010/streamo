// StreamingCommunity catalog access: base-URL discovery (telegra.ph link
// aggregator), Inertia page parsing, search, title details and seasons.
// Playback (vixcloud) lives in playback.ts.

import {
  type MediaType,
  decodeHtmlEntities,
  extractYear,
  fetchText,
  fetchWithTimeout,
  firstMatch,
  normalizeBaseURL,
  normalizeMediaType
} from './util.js';

const CATALOG_LINK_SOURCE_URL =
  process.env.CATALOG_LINK_SOURCE_URL
  || 'https://api.telegra.ph/getPage/Link-Aggiornato-StreamingCommunity-09-29?return_content=true';
export const CATALOG_LOCALE = (process.env.CATALOG_LOCALE || 'it').trim() || 'it';

const REQUEST_TIMEOUT_MS = 8000;
const BASE_URL_TTL_MS = 10 * 60 * 1000;

let cachedBaseURL: { value: string; fetchedAt: number } | null = null;

// --- Types -------------------------------------------------------------------

type ProviderImage = {
  filename?: string | null;
  type?: string | null;
};

type RawSearchTitle = {
  id?: number | null;
  slug?: string | null;
  name?: string | null;
  type?: string | null;
  score?: string | null;
  seasons_count?: number | null;
  last_air_date?: string | null;
  images?: ProviderImage[] | null;
  translations?: Array<{ key?: string | null; value?: string | null }> | null;
};

type RawTitleDetail = RawSearchTitle & {
  original_name?: string | null;
  plot?: string | null;
  runtime?: number | null;
  release_date?: string | null;
  imdb_id?: string | null;
  tmdb_id?: number | null;
  genres?: Array<{ name?: string | null }> | null;
  seasons?: Array<{ number?: number | null; episodes_count?: number | null }> | null;
};

type RawSeason = {
  number?: number | null;
  episodes?: Array<{
    id?: number | null;
    number?: number | null;
    name?: string | null;
    plot?: string | null;
    duration?: number | null;
    images?: ProviderImage[] | null;
  }> | null;
};

export type CatalogTitle = {
  id: number;
  slug: string;
  name: string;
  type: MediaType;
  year: number | null;
  score: string | null;
  plot: string | null;
  posterURL: string | null;
  backgroundURL: string | null;
};

export type TitleDetail = CatalogTitle & {
  originalName: string | null;
  runtime: number | null;
  releaseDate: string | null;
  imdbId: string | null;
  tmdbId: number | null;
  genres: string[];
  seasons: Array<{ number: number; episodesCount: number | null }>;
  logoURL: string | null;
};

export type TitleRef = { id: number; slug: string };

export type SeasonEpisode = {
  id: number;
  number: number;
  name: string | null;
  plot: string | null;
  duration: number | null;
  coverURL: string | null;
};

type InertiaPage = {
  props?: Record<string, unknown>;
};

// --- Base URL discovery ----------------------------------------------------------

export async function catalogBaseURL(): Promise<string | null> {
  if (cachedBaseURL && (Date.now() - cachedBaseURL.fetchedAt) < BASE_URL_TTL_MS) {
    return cachedBaseURL.value;
  }

  const response = await fetchWithTimeout(CATALOG_LINK_SOURCE_URL, {
    headers: { accept: 'application/json' }
  }, REQUEST_TIMEOUT_MS).catch(() => null);

  if (!response?.ok) {
    return cachedBaseURL?.value ?? null;
  }

  const payload = await response.json().catch(() => null) as {
    result?: { content?: unknown[] };
  } | null;
  const href = firstHref(payload?.result?.content);
  const normalized = href ? normalizeBaseURL(href) : null;
  if (!normalized) {
    return cachedBaseURL?.value ?? null;
  }

  cachedBaseURL = { value: normalized, fetchedAt: Date.now() };
  return normalized;
}

function firstHref(nodes: unknown[] | undefined): string | null {
  if (!Array.isArray(nodes)) {
    return null;
  }

  for (const node of nodes) {
    if (node && typeof node === 'object') {
      const href = (node as { attrs?: { href?: unknown } }).attrs?.href;
      if (typeof href === 'string' && href.trim()) {
        return href.trim();
      }
      const childHref = firstHref((node as { children?: unknown[] }).children);
      if (childHref) {
        return childHref;
      }
    }
  }

  return null;
}

// --- Inertia page fetching ---------------------------------------------------------

/// Fetches a provider page and returns the parsed Inertia payload, whether the
/// server answered with JSON (XHR navigation) or a full HTML document carrying
/// the `data-page` attribute.
async function fetchInertiaPage(url: string | URL): Promise<InertiaPage | null> {
  const response = await fetchWithTimeout(url, {
    headers: {
      accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8'
    },
    referrerPolicy: 'no-referrer'
  }, REQUEST_TIMEOUT_MS).catch(() => null);

  if (!response?.ok) {
    return null;
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return await response.json().catch(() => null) as InertiaPage | null;
  }

  const html = await response.text().catch(() => '');
  return parseInertiaPage(html);
}

function parseInertiaPage(html: string): InertiaPage | null {
  const marker = 'data-page=';
  const start = html.indexOf(marker);
  if (start < 0) {
    return null;
  }

  const quote = html[start + marker.length];
  if (quote !== '"' && quote !== '\'') {
    return null;
  }

  let i = start + marker.length + 1;
  let value = '';
  while (i < html.length) {
    const ch = html[i];
    if (ch === quote) {
      break;
    }
    value += ch;
    i += 1;
  }

  if (!value) {
    return null;
  }

  const decoded = decodeHtmlEntities(value);
  try {
    return JSON.parse(decoded) as InertiaPage;
  } catch {
    return null;
  }
}

function cdnURLOf(page: InertiaPage | null): string | null {
  const value = page?.props?.cdn_url;
  return typeof value === 'string' && value.trim() ? value.trim().replace(/\/$/, '') : null;
}

function imageURL(images: ProviderImage[] | null | undefined, type: string, cdnURL: string | null): string | null {
  if (!cdnURL || !Array.isArray(images)) {
    return null;
  }
  const match = images.find((image) => image?.type === type && image?.filename);
  return match?.filename ? `${cdnURL}/images/${match.filename}` : null;
}

function translationValue(entry: RawSearchTitle, key: string): string | null {
  const value = entry.translations?.find((translation) => translation.key === key)?.value;
  return value?.trim() || null;
}

function releaseDateOf(title: RawSearchTitle): string | null {
  const translated = title.translations?.find((entry) => entry.key === 'release_date' || entry.key === 'last_air_date')?.value;
  return translated?.trim() || title.last_air_date?.trim() || null;
}

// --- Search ---------------------------------------------------------------------

export async function searchCatalog(query: string): Promise<CatalogTitle[] | null> {
  const baseURL = await catalogBaseURL();
  if (!baseURL) {
    return null;
  }

  const url = new URL(`/${CATALOG_LOCALE}/search`, baseURL);
  url.searchParams.set('q', query);
  const page = await fetchInertiaPage(url);
  if (!page) {
    return null;
  }

  const cdnURL = cdnURLOf(page);
  return extractSearchTitles(page)
    .map((entry) => {
      const type = normalizeMediaType(entry.type);
      const slug = entry.slug?.trim();
      const name = entry.name?.trim();
      if (typeof entry.id !== 'number' || !type || !slug || !name) {
        return null;
      }
      return {
        id: entry.id,
        slug,
        name,
        type,
        year: extractYear(releaseDateOf(entry)),
        score: entry.score?.trim() || null,
        plot: translationValue(entry, 'plot'),
        posterURL: imageURL(entry.images, 'poster', cdnURL),
        backgroundURL: imageURL(entry.images, 'background', cdnURL)
      };
    })
    .filter((entry): entry is CatalogTitle => Boolean(entry));
}

function extractSearchTitles(page: InertiaPage): RawSearchTitle[] {
  const titles = (page.props as { titles?: RawSearchTitle[] | { data?: RawSearchTitle[] } } | undefined)?.titles;
  if (Array.isArray(titles)) {
    return titles;
  }
  if (titles && Array.isArray((titles as { data?: RawSearchTitle[] }).data)) {
    return (titles as { data?: RawSearchTitle[] }).data ?? [];
  }
  return [];
}

// --- Title details / seasons --------------------------------------------------------

export async function titleDetail(titleId: number, slug: string): Promise<TitleDetail | null> {
  const baseURL = await catalogBaseURL();
  if (!baseURL) {
    return null;
  }

  const url = new URL(`/${CATALOG_LOCALE}/titles/${titleId}-${slug}`, baseURL);
  const page = await fetchInertiaPage(url);
  const title = (page?.props as { title?: RawTitleDetail } | undefined)?.title;
  const type = normalizeMediaType(title?.type);
  const name = title?.name?.trim();
  if (!title || typeof title.id !== 'number' || !type || !name) {
    return null;
  }

  const cdnURL = cdnURLOf(page);
  return {
    id: title.id,
    slug: title.slug?.trim() || slug,
    name,
    type,
    year: extractYear(title.release_date ?? title.last_air_date),
    score: title.score?.trim() || null,
    plot: title.plot?.trim() || null,
    posterURL: imageURL(title.images, 'poster', cdnURL),
    backgroundURL: imageURL(title.images, 'background', cdnURL),
    logoURL: imageURL(title.images, 'logo', cdnURL),
    originalName: title.original_name?.trim() || null,
    runtime: title.runtime ?? null,
    releaseDate: title.release_date?.trim() || null,
    imdbId: title.imdb_id?.trim() || null,
    tmdbId: typeof title.tmdb_id === 'number' ? title.tmdb_id : null,
    genres: (title.genres ?? [])
      .map((genre) => genre?.name?.trim())
      .filter((genre): genre is string => Boolean(genre)),
    seasons: (title.seasons ?? [])
      .filter((season) => typeof season?.number === 'number')
      .map((season) => ({
        number: season.number!,
        episodesCount: season.episodes_count ?? null
      }))
  };
}

export async function seasonEpisodes(
  titleId: number,
  slug: string,
  seasonNumber: number
): Promise<SeasonEpisode[] | null> {
  const baseURL = await catalogBaseURL();
  if (!baseURL) {
    return null;
  }

  const url = new URL(`/${CATALOG_LOCALE}/titles/${titleId}-${slug}/season-${seasonNumber}`, baseURL);
  const page = await fetchInertiaPage(url);
  const season = (page?.props as { loadedSeason?: RawSeason } | undefined)?.loadedSeason;
  if (!season) {
    return null;
  }

  const cdnURL = cdnURLOf(page);
  return (season.episodes ?? [])
    .filter((episode) => typeof episode.id === 'number' && typeof episode.number === 'number')
    .map((episode) => ({
      id: episode.id!,
      number: episode.number!,
      name: episode.name?.trim() || null,
      plot: episode.plot?.trim() || null,
      duration: episode.duration ?? null,
      coverURL: imageURL(episode.images, 'cover', cdnURL)
    }));
}

// --- Embed URL (playback entry point) -------------------------------------------------

export async function fetchEmbedURL(titleId: number, episodeId?: number): Promise<string | null> {
  const baseURL = await catalogBaseURL();
  if (!baseURL) {
    return null;
  }

  const url = new URL(`/${CATALOG_LOCALE}/iframe/${titleId}`, baseURL);
  if (episodeId) {
    url.searchParams.set('episode_id', String(episodeId));
    url.searchParams.set('next_episode', '1');
  }

  const html = await fetchText(url.toString(), {
    accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8'
  }, REQUEST_TIMEOUT_MS);
  if (!html) {
    return null;
  }

  const raw = firstMatch(html, /<iframe[^>]+src="([^"]+)"/i)
    ?? firstMatch(html, /<iframe[^>]+src='([^']+)'/i);
  if (!raw) {
    return null;
  }

  const embedURL = decodeHtmlEntities(raw.trim());
  try {
    const parsed = new URL(embedURL, baseURL);
    if (parsed.hostname !== 'vixcloud.co' || !parsed.pathname.startsWith('/embed/')) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}
