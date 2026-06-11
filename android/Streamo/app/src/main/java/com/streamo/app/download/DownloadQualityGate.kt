package com.streamo.app.download

import androidx.media3.common.util.UnstableApi
import com.streamo.app.data.preferences.SettingsDataStore
import com.streamo.app.util.ConnectivityHelper
import kotlinx.coroutines.flow.first
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Punto unico per la logica "qualità download": tipo di rete corrente, preferenza per rete,
 * salvataggio, e rilevamento risoluzioni. Usato da DetailViewModel e SeriesDownloadsViewModel
 * per decidere se scaricare diretto o mostrare la modale di scelta.
 */
@UnstableApi
@Singleton
class DownloadQualityGate @Inject constructor(
    private val settings: SettingsDataStore,
    private val connectivity: ConnectivityHelper,
    private val probe: DownloadResolutionProbe
) {
    fun currentNetwork(): NetworkType = connectivity.currentNetworkType()

    suspend fun preferenceFor(net: NetworkType): DownloadQualityPref {
        val raw = when (net) {
            NetworkType.WIFI -> settings.downloadQualityWifi.first()
            NetworkType.MOBILE -> settings.downloadQualityMobile.first()
        }
        return DownloadQualityPref.parse(raw)
    }

    suspend fun savePreference(net: NetworkType, pref: DownloadQualityPref) {
        when (net) {
            NetworkType.WIFI -> settings.setDownloadQualityWifi(pref.serialize())
            NetworkType.MOBILE -> settings.setDownloadQualityMobile(pref.serialize())
        }
    }

    suspend fun availableHeights(
        tmdbId: Int,
        mediaType: String,
        title: String,
        season: Int,
        episode: Int
    ): List<Int> = probe.availableHeights(tmdbId, mediaType, title, season, episode)
}
