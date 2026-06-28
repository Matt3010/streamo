package com.streamo.app.data.model

/**
 * Legacy model kept for download worker compatibility.
 * New code uses provider/ProviderModels.kt types instead.
 */
data class ProviderMapping(
    val scId: Int,
    val scSlug: String,
    val scType: String,
    val title: String,
    val scBaseUrl: String,
    val quality: String? = null
)

/** @deprecated Use com.streamo.provider.sdk.PlaybackSource instead. */
data class StreamSource(
    val url: String,
    val quality: String? = null,
    val isM3u8: Boolean = true
)