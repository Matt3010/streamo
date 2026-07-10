// Wire + domain types for the StreamingCommunity provider resolution.
// Port of ProviderModels.kt. The Kotlin Gson custom deserializers become
// runtime parsing helpers in inertia.ts / ProviderClient.ts.

export type MediaType = 'movie' | 'tv';

/** A confirmed StreamingCommunity title mapped to a TMDB id. */
export interface ProviderResolvedTitle {
  id: number;
  slug?: string | null;
  title: string;
  mediaType: MediaType;
}

/** A picker candidate (weak / alternative matches). */
export interface ProviderCandidate {
  providerTitleId: number;
  providerSlug?: string | null;
  title: string;
  year?: number | null;
  score: number;
  posterUrl?: string | null;
}

export type ProviderMatchStatus = 'auto_confirmed' | 'manual_confirmed' | 'failed';
export type ProviderResolveFailureReason = 'NOT_FOUND' | 'TEMPORARILY_UNAVAILABLE' | 'UNRELEASED';

export interface ProviderResolveTitleOutcome {
  resolved: ProviderResolvedTitle | null;
  reason: ProviderResolveFailureReason | null;
  candidates: ProviderCandidate[];
  matchStatus: ProviderMatchStatus | null;
}

export interface ProviderEmbedOutcome {
  embedUrl: string | null;
  reason: ProviderResolveFailureReason | null;
}

// region Inertia data-page payloads

export interface ProviderTranslation {
  key?: string | null;
  value?: string | null;
}

export interface ProviderSearchTitle {
  id?: number | null;
  slug?: string | null;
  name?: string | null;
  type?: string | null;
  lastAirDate?: string | null;
  translations?: ProviderTranslation[] | null;
}

// titles container can be a bare array OR { data: [...] } OR { titles: [...] }
export interface ProviderSearchPage {
  props?: {
    titles?: { titles?: ProviderSearchTitle[] } | ProviderSearchTitle[];
  };
}

export interface ProviderSeasonSummary {
  id?: number | null;
  number?: number | null;
  episodesCount?: number | null;
}

export interface ProviderEpisode {
  id?: number | null;
  number?: number | null;
  scwsId?: number | null;
  seasonId?: number | null;
}

export interface ProviderLoadedSeason {
  id?: number | null;
  number?: number | null;
  episodes?: ProviderEpisode[] | null;
}

export interface ProviderTitlePage {
  props?: {
    title?: { seasons?: ProviderSeasonSummary[] | null } | null;
    loadedSeason?: ProviderLoadedSeason | null;
  };
}

// endregion

// region Telegraph API response

export interface TelegraphResponse {
  result?: { content?: TelegraphNode[] | null };
}
export interface TelegraphNode {
  tag?: string | null;
  attrs?: { href?: string | null } | null;
  children?: (string | TelegraphNode)[] | null;
}

// endregion

// region Playback models

export interface PlaybackSource {
  playlistUrl: string;
  headers: Record<string, string>;
}

export interface PlaybackResolution {
  sources: PlaybackSource[];
  reason: ProviderResolveFailureReason | null;
  message: string | null;
  providerTitle: ProviderResolvedTitle | null;
  candidates: ProviderCandidate[];
  viaProxy: boolean;
}

// endregion