package com.streamo.provider.sdk;

/**
 * IPC contract between the catalog host and a streaming-provider extension.
 *
 * All structured values cross as JSON strings encoded with ProviderJson (the
 * provider-neutral @Serializable models), so this .aidl stays free of custom
 * Parcelables and the host/extension only have to agree on the JSON format.
 *
 * `useProxy`/`proxyPort` carry the host's WARP loopback proxy: when useProxy is
 * true the extension must route its provider/embed HTTP through
 * 127.0.0.1:proxyPort so the vixcloud token binds to the same egress IP the host
 * fetches media with. `locale` is the host's provider language preference.
 */
interface IStreamProviderService {

    /** ProviderMetadata as JSON. */
    String metadata();

    /** ProviderResolveTitleOutcome as JSON. */
    String resolveTitle(
        int tmdbId, String mediaType, String title, String releaseDate,
        boolean forceRefresh, boolean useProxy, int proxyPort, String locale);

    /** PlaybackResolution as JSON. */
    String movieSource(
        int tmdbId, String title, String releaseDate,
        boolean useProxy, int proxyPort, String locale);

    /** PlaybackResolution as JSON. */
    String episodeSource(
        int tmdbId, String title, String releaseDate, int season, int episode,
        boolean useProxy, int proxyPort, String locale);

    /** candidateJson = ProviderCandidate as JSON. */
    void confirmCandidate(String candidateJson, int tmdbId, String mediaType);

    /** outcomeJson = ProviderResolveTitleOutcome as JSON. */
    void prime(int tmdbId, String mediaType, String outcomeJson);

    void invalidate(int tmdbId, String mediaType);

    /** Recent provider debug log lines (newline-joined) for the host log viewer. */
    String debugLogs();
}
