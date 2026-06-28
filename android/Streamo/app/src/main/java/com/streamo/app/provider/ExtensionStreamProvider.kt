package com.streamo.app.provider

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.IBinder
import com.streamo.app.data.preferences.SettingsDataStore
import com.streamo.app.provider.warp.WarpTunnel
import com.streamo.provider.sdk.IStreamProviderService
import com.streamo.provider.sdk.PlaybackResolution
import com.streamo.provider.sdk.ProviderCandidate
import com.streamo.provider.sdk.ProviderJson
import com.streamo.provider.sdk.ProviderMetadata
import com.streamo.provider.sdk.ProviderResolveTitleOutcome
import com.streamo.provider.sdk.StreamProvider
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/**
 * Host-side [StreamProvider] that talks to a separately-installed provider
 * extension over its bound [IStreamProviderService] (AIDL + JSON payloads).
 *
 * WARP stays in the host: before each resolve we bring up the host tunnel and
 * pass its loopback proxy port to the extension, so the extension's vixcloud
 * resolve and the host's media fetch share the same egress IP (token binding).
 */
class ExtensionStreamProvider(
    private val context: Context,
    private val component: ComponentName,
    override val metadata: ProviderMetadata,
    private val warpTunnel: WarpTunnel,
    private val settings: SettingsDataStore,
) : StreamProvider {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val bindMutex = Mutex()
    @Volatile private var service: IStreamProviderService? = null
    @Volatile private var pending: CompletableDeferred<IStreamProviderService>? = null

    private val connection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName, binder: IBinder) {
            val svc = IStreamProviderService.Stub.asInterface(binder)
            service = svc
            pending?.complete(svc)
        }

        override fun onServiceDisconnected(name: ComponentName) {
            service = null
            pending = null
        }
    }

    /** Bind (once) and await the AIDL interface. Kept bound for the session so
     * long downloads don't drop the connection. */
    private suspend fun service(): IStreamProviderService {
        service?.let { return it }
        return bindMutex.withLock {
            service?.let { return it }
            val deferred = CompletableDeferred<IStreamProviderService>()
            pending = deferred
            val intent = Intent().setComponent(component)
            val ok = context.bindService(intent, connection, Context.BIND_AUTO_CREATE)
            if (!ok) {
                pending = null
                throw IllegalStateException("Impossibile collegarsi al provider di streaming")
            }
            deferred.await()
        }
    }

    /** Host WARP state to hand the extension: (useProxy, proxyPort). */
    private suspend fun warpContext(): Pair<Boolean, Int> {
        val enabled = settings.warpEnabled.first()
        if (!enabled || !warpTunnel.isAvailable) return false to 0
        return if (warpTunnel.start()) true to warpTunnel.proxyPort else false to 0
    }

    private suspend fun locale(): String = settings.providerLocale.first()

    override suspend fun resolveTitle(
        tmdbId: Int,
        mediaType: String,
        title: String,
        releaseDate: String?,
        forceRefresh: Boolean
    ): ProviderResolveTitleOutcome = withContext(Dispatchers.IO) {
        val (useProxy, port) = warpContext()
        val json = service().resolveTitle(tmdbId, mediaType, title, releaseDate, forceRefresh, useProxy, port, locale())
        ProviderJson.decodeOutcome(json)
    }

    override suspend fun movieSource(
        tmdbId: Int,
        title: String,
        releaseDate: String?
    ): PlaybackResolution = withContext(Dispatchers.IO) {
        val (useProxy, port) = warpContext()
        val json = service().movieSource(tmdbId, title, releaseDate, useProxy, port, locale())
        ProviderJson.decodeResolution(json)
    }

    override suspend fun episodeSource(
        tmdbId: Int,
        title: String,
        releaseDate: String?,
        season: Int,
        episode: Int
    ): PlaybackResolution = withContext(Dispatchers.IO) {
        val (useProxy, port) = warpContext()
        val json = service().episodeSource(tmdbId, title, releaseDate, season, episode, useProxy, port, locale())
        ProviderJson.decodeResolution(json)
    }

    // Cache ops are fire-and-forget on the extension's in-session cache.
    override fun confirmCandidate(candidate: ProviderCandidate, tmdbId: Int, mediaType: String) {
        scope.launch { runCatching { service().confirmCandidate(ProviderJson.encodeCandidate(candidate), tmdbId, mediaType) } }
    }

    override fun prime(tmdbId: Int, mediaType: String, outcome: ProviderResolveTitleOutcome) {
        scope.launch { runCatching { service().prime(tmdbId, mediaType, ProviderJson.encodeOutcome(outcome)) } }
    }

    override fun invalidate(tmdbId: Int, mediaType: String) {
        scope.launch { runCatching { service().invalidate(tmdbId, mediaType) } }
    }

    /** Recent extension-side debug logs for the host log viewer. */
    suspend fun debugLogs(): String = withContext(Dispatchers.IO) {
        runCatching { service().debugLogs() }.getOrDefault("")
    }
}
