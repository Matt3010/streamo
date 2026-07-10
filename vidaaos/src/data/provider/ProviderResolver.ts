// High-level orchestration: TMDB title -> provider title -> episode/movie embed
// -> playable HLS source. Caches resolved titles in memory for the session;
// durable persistence lives in Dexie providerMapping (wired here).
// Port of ProviderResolver.kt. WARP on web = a flag passed to the proxy (no
// client swapping — egress is proxy-side).
import { settings } from '../settings';
import { repo } from '../repositories';
import * as provider from './ProviderClient';
import { playbackSources, VixError } from './VixcloudClient';
import { AnimeUnityClient } from '../anime/AnimeUnityClient';
import type {
  ProviderResolveTitleOutcome,
  ProviderResolvedTitle,
  ProviderCandidate,
  ProviderMatchStatus,
  ProviderResolveFailureReason,
  PlaybackResolution,
  PlaybackSource,
  MediaType
} from './models';

const titleCache = new Map<string, ProviderResolveTitleOutcome>();

function cacheKey(id: number, type: string, useProxy: boolean): string {
  return `${type}:${id}:${useProxy ? 'proxy' : 'local'}`;
}
function cacheKeysForAllModes(id: number, type: string): string[] {
  return [cacheKey(id, type, false), cacheKey(id, type, true)];
}

/** Effective WARP state = the settings toggle (egress is proxy-side). */
function prepareWARP(): boolean {
  return settings.warpEnabled.value;
}

export function prime(tmdbId: number, mediaType: string, outcome: ProviderResolveTitleOutcome): void {
  for (const k of cacheKeysForAllModes(tmdbId, mediaType)) titleCache.set(k, outcome);
}

export function invalidate(tmdbId: number, mediaType: string): void {
  for (const k of cacheKeysForAllModes(tmdbId, mediaType)) titleCache.delete(k);
}

export async function resolveTitle(
  tmdbId: number,
  mediaType: MediaType,
  title: string,
  releaseDate: string | null,
  forceRefresh = false
): Promise<ProviderResolveTitleOutcome> {
  const useProxy = prepareWARP();
  const key = cacheKey(tmdbId, mediaType, useProxy);
  if (!forceRefresh) {
    const cached = titleCache.get(key);
    if (cached) return cached;
  }
  const outcome = await provider.resolveTitle(tmdbId, mediaType, title, releaseDate);
  titleCache.set(key, outcome);
  return outcome;
}

/** Manually pin a candidate as the resolved title (provider picker). */
export function confirmCandidate(candidate: ProviderCandidate, tmdbId: number, mediaType: MediaType): void {
  const resolved: ProviderResolvedTitle = {
    id: candidate.providerTitleId,
    slug: candidate.providerSlug,
    title: candidate.title,
    mediaType
  };
  const existing =
    cacheKeysForAllModes(tmdbId, mediaType)
      .map((k) => titleCache.get(k)?.candidates)
      .find((c) => c && c.length > 0) ?? [];
  const outcome: ProviderResolveTitleOutcome = {
    resolved,
    reason: null,
    candidates: existing,
    matchStatus: 'manual_confirmed'
  };
  for (const k of cacheKeysForAllModes(tmdbId, mediaType)) titleCache.set(k, outcome);
}

// region Playable source

export async function movieSource(
  tmdbId: number,
  title: string,
  releaseDate: string | null
): Promise<PlaybackResolution> {
  const useProxy = prepareWARP();
  const outcome = await resolveTitle(tmdbId, 'movie', title, releaseDate, false);
  const resolved = outcome.resolved;
  if (!resolved) {
    return noSources(outcome.reason ?? 'NOT_FOUND', outcome.candidates, useProxy);
  }
  const embed = await provider.movieEmbed(resolved.id);
  return finalize(embed, resolved, outcome.candidates, useProxy);
}

export async function episodeSource(
  tmdbId: number,
  title: string,
  releaseDate: string | null,
  season: number,
  episode: number
): Promise<PlaybackResolution> {
  const useProxy = prepareWARP();
  const outcome = await resolveTitle(tmdbId, 'tv', title, releaseDate, false);
  const resolved = outcome.resolved;
  if (!resolved) {
    return noSources(outcome.reason ?? 'NOT_FOUND', outcome.candidates, useProxy);
  }
  const embed = await provider.episodeEmbed(resolved.id, resolved.slug, season, episode);
  return finalize(embed, resolved, outcome.candidates, useProxy);
}

/** AnimeUnity stretch (Phase 9). Stubbed — not part of the core happy path. */
export async function animeSource(
  animeId: number,
  slug: string | null,
  episodeId: number
): Promise<PlaybackResolution> {
  const useProxy = prepareWARP();
  try {
    const embedUrl = await AnimeUnityClient.embedUrl(animeId, episodeId, slug);
    const sources = await playbackSources(embedUrl, useProxy);
    return { sources, reason: null, message: null, providerTitle: null, candidates: [], viaProxy: useProxy };
  } catch (e) {
    return { sources: [], reason: 'TEMPORARILY_UNAVAILABLE', message: e instanceof Error ? e.message : 'Riproduzione non disponibile.', providerTitle: null, candidates: [], viaProxy: useProxy };
  }
}

async function finalize(
  embed: { embedUrl: string | null; reason: ProviderResolveFailureReason | null },
  resolved: ProviderResolvedTitle,
  candidates: ProviderCandidate[],
  useProxy: boolean
): Promise<PlaybackResolution> {
  if (!embed.embedUrl) {
    return {
      sources: [],
      reason: embed.reason ?? 'NOT_FOUND',
      message: unavailableMessage(embed.reason),
      providerTitle: resolved,
      candidates,
      viaProxy: useProxy
    };
  }
  try {
    const sources: PlaybackSource[] = await playbackSources(embed.embedUrl, useProxy);
    return { sources, reason: null, message: null, providerTitle: resolved, candidates, viaProxy: useProxy };
  } catch (e) {
    return {
      sources: [],
      reason: 'TEMPORARILY_UNAVAILABLE',
      message: e instanceof VixError ? e.message : 'Riproduzione non disponibile.',
      providerTitle: resolved,
      candidates,
      viaProxy: useProxy
    };
  }
}

function noSources(
  reason: ProviderResolveFailureReason,
  candidates: ProviderCandidate[],
  useProxy: boolean
): PlaybackResolution {
  return {
    sources: [],
    reason,
    message: unavailableMessage(reason),
    providerTitle: null,
    candidates,
    viaProxy: useProxy
  };
}

function unavailableMessage(reason: ProviderResolveFailureReason | null): string {
  switch (reason) {
    case 'TEMPORARILY_UNAVAILABLE':
      return 'Riproduzione temporaneamente non disponibile';
    case 'UNRELEASED':
      return 'Non ancora disponibile';
    default:
      return 'Titolo non disponibile';
  }
}

// endregion

// region Persistence helpers

export async function saveMapping(tmdbId: number, mediaType: string, outcome: ProviderResolveTitleOutcome): Promise<void> {
  const resolved = outcome.resolved;
  if (!resolved) return;
  await repo.saveProviderMapping({
    tmdbId,
    scId: resolved.id,
    scSlug: resolved.slug ?? '',
    scType: mediaType,
    scBaseUrl: ''
  });
}

export async function loadAndPrime(tmdbId: number, mediaType: string): Promise<void> {
  const entity = await repo.getProviderMapping(tmdbId);
  if (!entity) return;
  const resolved: ProviderResolvedTitle = {
    id: entity.scId,
    slug: entity.scSlug ? entity.scSlug : null,
    title: '',
    mediaType: entity.scType as MediaType
  };
  prime(tmdbId, mediaType, {
    resolved,
    reason: null,
    candidates: [],
    matchStatus: 'manual_confirmed' as ProviderMatchStatus
  });
}

// endregion
