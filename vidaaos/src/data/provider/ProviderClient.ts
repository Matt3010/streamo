// Scrapes StreamingCommunity to map a TMDB title to a playable vixcloud embed URL.
// Port of ProviderClient.kt. The full pipeline: telegra.ph base resolve -> search
// -> score -> (TV) fetchSeason -> fetchEmbedURL -> vixcloud embed URL (handoff to proxy).
import { settings } from '../settings';
import { isFutureDate } from '../../util/tvlogic';
import { httpGet } from '../../util/request';
import {
  score,
  normalizeType,
  releaseDate,
  extractYear,
  decodeHTMLEntities,
  firstMatch,
  STRONG_MATCH_THRESHOLD,
  MIN_CANDIDATE_SCORE,
  MAX_STORED_CANDIDATES
} from './scoring';
import { extractInertiaPage, extractTitles } from './inertia';
import type {
  ProviderSearchTitle,
  ProviderSearchPage,
  ProviderTitlePage,
  ProviderLoadedSeason,
  ProviderResolveTitleOutcome,
  ProviderResolveFailureReason,
  ProviderCandidate,
  ProviderResolvedTitle,
  ProviderEmbedOutcome,
  TelegraphResponse,
  TelegraphNode,
  MediaType
} from './models';

const LINK_SOURCE_URL =
  'https://api.telegra.ph/getPage/Link-Aggiornato-StreamingCommunity-09-29?return_content=true';
const BASE_URL_TTL_MS = 10 * 60 * 1000;

// ponytail: module-level cache for the base URL (10-min TTL + stale fallback).
let cachedBaseURL: string | null = null;
let baseURLFetchedAt: number | null = null;

export async function baseURL(): Promise<string | null> {
  if (cachedBaseURL && baseURLFetchedAt && Date.now() - baseURLFetchedAt < BASE_URL_TTL_MS) {
    return cachedBaseURL;
  }
  const fresh = await fetchBaseURL();
  if (fresh) {
    cachedBaseURL = fresh;
    baseURLFetchedAt = Date.now();
    return fresh;
  }
  return cachedBaseURL; // stale fallback on transient failure
}

export function invalidateBaseURL(): void {
  cachedBaseURL = null;
  baseURLFetchedAt = null;
}

async function fetchBaseURL(): Promise<string | null> {
  const res = await httpGet(LINK_SOURCE_URL, 'application/json');
  if (!res) return null;
  try {
    const telegraph = JSON.parse(res.body) as TelegraphResponse;
    const nodes = telegraph.result?.content;
    if (!nodes) return null;
    const href = firstHref(nodes);
    if (!href) return null;
    return normalizeBaseURL(href);
  } catch {
    return null;
  }
}

function firstHref(nodes: TelegraphNode[]): string | null {
  for (const node of nodes) {
    const h = hrefIn(node);
    if (h) return h;
  }
  return null;
}

function hrefIn(node: TelegraphNode): string | null {
  const h = node.attrs?.href?.trim();
  if (h) return h;
  if (node.children) {
    for (const child of node.children) {
      if (typeof child !== 'string') {
        const found = hrefIn(child);
        if (found) return found;
      }
    }
  }
  return null;
}

function normalizeBaseURL(href: string): string | null {
  try {
    let s = href.trim();
    if (s.endsWith('/')) s = s.slice(0, -1);
    const url = new URL(s);
    if (!url.protocol || !url.host) return null;
    return s;
  } catch {
    return null;
  }
}

function locale(): string {
  return settings.providerLocale.value;
}

// region Title resolution

export async function resolveTitle(
  tmdbId: number,
  mediaType: MediaType,
  title: string,
  releaseDateStr: string | null
): Promise<ProviderResolveTitleOutcome> {
  const query = title.trim();
  if (query === '') return failed('NOT_FOUND');

  if (isFutureDate(releaseDateStr)) return failed('UNRELEASED');

  const titles = await search(query);
  if (titles === null) {
    return { resolved: null, reason: 'TEMPORARILY_UNAVAILABLE', candidates: [], matchStatus: null };
  }

  const wantedYear = extractYear(releaseDateStr);
  const ranked = titles
    .filter((t) => t.id != null && normalizeType(t.type) === mediaType)
    .map((t) => ({ t, s: score(t, query, wantedYear) }))
    .sort((a, b) => b.s - a.s);

  const candidates: ProviderCandidate[] = ranked
    .filter((r) => r.s >= MIN_CANDIDATE_SCORE)
    .slice(0, MAX_STORED_CANDIDATES)
    .map(({ t, s }) => ({
      providerTitleId: t.id!,
      providerSlug: t.slug,
      title: t.name?.trim() ?? query,
      year: extractYear(releaseDate(t)),
      score: s
    }));

  const best = ranked[0];
  if (!best || best.s < MIN_CANDIDATE_SCORE || best.t.id == null) {
    return { resolved: null, reason: 'NOT_FOUND', candidates, matchStatus: 'failed' };
  }

  if (best.s >= STRONG_MATCH_THRESHOLD) {
    const resolved: ProviderResolvedTitle = {
      id: best.t.id,
      slug: best.t.slug,
      title: best.t.name?.trim() ?? query,
      mediaType
    };
    return { resolved, reason: null, candidates, matchStatus: 'auto_confirmed' };
  }

  // Weak match: keep candidates for the picker, don't auto-confirm.
  return { resolved: null, reason: 'NOT_FOUND', candidates, matchStatus: 'failed' };
}

function failed(reason: ProviderResolveFailureReason): ProviderResolveTitleOutcome {
  return { resolved: null, reason, candidates: [], matchStatus: 'failed' };
}

// endregion

// region Search

async function search(query: string): Promise<ProviderSearchTitle[] | null> {
  const base = await baseURL();
  if (!base) return null;
  const url = `${base}/${locale()}/search?q=${encodeURIComponent(query)}`;
  const res = await httpGet(url);
  if (!res) return null;

  let page: ProviderSearchPage | null = null;
  if (res.contentType?.includes('application/json')) {
    try {
      page = JSON.parse(res.body) as ProviderSearchPage;
    } catch {
      page = null;
    }
  } else {
    page = extractInertiaPage(res.body) as ProviderSearchPage | null;
  }

  const titlesContainer = page?.props?.titles;
  // titles container can be { titles: [...] | array } — extractTitles handles both.
  const titles = titlesContainer
    ? extractTitles((titlesContainer as any).titles ?? titlesContainer)
    : [];
  return titles as ProviderSearchTitle[];
}

// endregion

// region Episode / Movie embed

export async function episodeEmbed(
  providerTitleId: number,
  slug: string | null | undefined,
  season: number,
  episode: number
): Promise<ProviderEmbedOutcome> {
  const loaded = await fetchSeason(providerTitleId, slug, season);
  if (!loaded) return { embedUrl: null, reason: 'TEMPORARILY_UNAVAILABLE' };
  const episodes = loaded.episodes ?? [];
  if (episodes.length === 0) return { embedUrl: null, reason: 'TEMPORARILY_UNAVAILABLE' };
  const match = episodes.find((e) => e.number === episode && e.id != null);
  if (!match) return { embedUrl: null, reason: 'NOT_FOUND' };
  const embed = await fetchEmbedURL(providerTitleId, match.id!);
  if (!embed) return { embedUrl: null, reason: 'TEMPORARILY_UNAVAILABLE' };
  return { embedUrl: embed, reason: null };
}

export async function movieEmbed(providerTitleId: number): Promise<ProviderEmbedOutcome> {
  const embed = await fetchEmbedURL(providerTitleId, null);
  if (!embed) return { embedUrl: null, reason: 'TEMPORARILY_UNAVAILABLE' };
  return { embedUrl: embed, reason: null };
}

// endregion

// region Network primitives

async function fetchSeason(
  providerTitleId: number,
  slug: string | null | undefined,
  seasonNumber: number
): Promise<ProviderLoadedSeason | null> {
  const base = await baseURL();
  if (!base) return null;
  const resolvedSlug = slug?.trim();
  if (!resolvedSlug) return null;
  const url = `${base}/${locale()}/titles/${providerTitleId}-${resolvedSlug}/season-${seasonNumber}`;
  const res = await httpGet(url);
  if (!res) return null;

  let page: ProviderTitlePage | null = null;
  if (res.contentType?.includes('application/json')) {
    try {
      page = JSON.parse(res.body) as ProviderTitlePage;
    } catch {
      page = null;
    }
  } else {
    page = extractInertiaPage(res.body) as ProviderTitlePage | null;
  }
  return page?.props?.loadedSeason ?? null;
}

/** Fetch the iframe page and extract the absolute vixcloud embed URL. */
async function fetchEmbedURL(providerTitleId: number, episodeId: number | null): Promise<string | null> {
  const base = await baseURL();
  if (!base) return null;
  let url = `${base}/${locale()}/iframe/${providerTitleId}`;
  if (episodeId != null) url += `?episode_id=${episodeId}&next_episode=1`;
  const res = await httpGet(url);
  if (!res) return null;
  const html = res.body;

  const raw =
    firstMatch(html, '<iframe[^>]+src="([^"]+)"') ??
    firstMatch(html, "<iframe[^>]+src='([^']+)'");
  if (!raw) return null;

  const embed = decodeHTMLEntities(raw.trim());
  try {
    const urlObj = new URL(embed);
    if (urlObj.host === 'vixcloud.co' && urlObj.pathname.startsWith('/embed/')) return embed;
    return null;
  } catch {
    return null;
  }
}

// endregion