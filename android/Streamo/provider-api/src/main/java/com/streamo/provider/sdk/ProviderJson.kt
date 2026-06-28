package com.streamo.provider.sdk

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/**
 * JSON codec used to marshal the provider-neutral models across the AIDL
 * boundary (see `IStreamProviderService.aidl`). Both the host and every
 * extension share this exact serializer so the wire format stays compatible.
 */
object ProviderJson {
    val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
    }

    fun encodeOutcome(value: ProviderResolveTitleOutcome): String = json.encodeToString(value)
    fun decodeOutcome(text: String): ProviderResolveTitleOutcome = json.decodeFromString(text)

    fun encodeResolution(value: PlaybackResolution): String = json.encodeToString(value)
    fun decodeResolution(text: String): PlaybackResolution = json.decodeFromString(text)

    fun encodeCandidate(value: ProviderCandidate): String = json.encodeToString(value)
    fun decodeCandidate(text: String): ProviderCandidate = json.decodeFromString(text)

    fun encodeMetadata(value: ProviderMetadata): String = json.encodeToString(value)
    fun decodeMetadata(text: String): ProviderMetadata = json.decodeFromString(text)
}

/** Shared IPC identifiers for discovering and binding a provider extension. */
object ProviderIpc {
    /** Intent action an extension's bound service must advertise. */
    const val ACTION_BIND = "com.streamo.provider.BIND"

    /** `<meta-data>` keys the extension declares on its service. */
    const val META_ID = "com.streamo.provider.ID"
    const val META_NAME = "com.streamo.provider.NAME"
    const val META_VERSION = "com.streamo.provider.VERSION"
}
