package com.streamo.app.provider

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import com.streamo.app.data.preferences.SettingsDataStore
import com.streamo.app.provider.warp.WarpTunnel
import com.streamo.provider.sdk.ProviderIpc
import com.streamo.provider.sdk.ProviderMetadata
import com.streamo.provider.sdk.StreamProvider
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Discovers the installed streaming-provider extension (a separate APK exposing
 * a bound service with action [ProviderIpc.ACTION_BIND]) and exposes it as the
 * active [StreamProvider]. When none is installed, [active] is null and the
 * catalog runs in its real NO_PROVIDER state.
 *
 * Discovery requires the host manifest to declare `<queries>` for the bind
 * action (Android 11+ package visibility).
 */
@Singleton
class ProviderManager @Inject constructor(
    @ApplicationContext private val context: Context,
    private val warpTunnel: WarpTunnel,
    private val settings: SettingsDataStore,
) {
    @Volatile private var cached: ExtensionStreamProvider? = null
    @Volatile private var resolvedFor: String? = null

    /** The provider currently used for resolution, or null when none is installed. */
    val active: StreamProvider?
        get() = synchronized(this) {
            val info = findExtension()
            if (info == null) {
                cached = null
                resolvedFor = null
                return null
            }
            val (component, metadata) = info
            if (cached == null || resolvedFor != component.packageName) {
                cached = ExtensionStreamProvider(context, component, metadata, warpTunnel, settings)
                resolvedFor = component.packageName
            }
            cached
        }

    val isAvailable: Boolean get() = active != null

    /** Whether a provider extension APK is installed (drives the install CTA). */
    val isExtensionInstalled: Boolean get() = findExtension() != null

    private fun findExtension(): Pair<ComponentName, ProviderMetadata>? {
        val intent = Intent(ProviderIpc.ACTION_BIND)
        val matches = context.packageManager.queryIntentServices(
            intent, PackageManager.GET_META_DATA
        )
        val svc = matches.firstOrNull()?.serviceInfo ?: return null
        val meta = svc.metaData
        val metadata = ProviderMetadata(
            id = meta?.getString(ProviderIpc.META_ID) ?: svc.packageName,
            name = meta?.getString(ProviderIpc.META_NAME) ?: "Provider",
            version = meta?.getString(ProviderIpc.META_VERSION) ?: ""
        )
        return ComponentName(svc.packageName, svc.name) to metadata
    }
}
