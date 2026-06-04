package com.streamo.app.util

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import com.streamo.app.download.NetworkType
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/** Rileva il tipo di rete attiva (Wi-Fi vs mobile). Permesso ACCESS_NETWORK_STATE già nel manifest. */
@Singleton
class ConnectivityHelper @Inject constructor(
    @ApplicationContext private val context: Context
) {
    /** WIFI se la rete attiva è Wi-Fi/Ethernet, altrimenti MOBILE (cellulare o sconosciuta). */
    fun currentNetworkType(): NetworkType {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
            ?: return NetworkType.MOBILE
        val caps = cm.activeNetwork?.let { cm.getNetworkCapabilities(it) }
            ?: return NetworkType.MOBILE
        val isWifiLike = caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
            caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
        return if (isWifiLike) NetworkType.WIFI else NetworkType.MOBILE
    }
}
