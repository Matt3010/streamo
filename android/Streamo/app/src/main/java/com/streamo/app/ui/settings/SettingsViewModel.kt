package com.streamo.app.ui.settings

import android.content.Context
import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.streamo.app.BuildConfig
import com.streamo.app.data.backup.BackupManager
import com.streamo.app.data.preferences.SettingsDataStore
import com.streamo.app.data.repository.AppRepository
import com.streamo.app.download.DownloadQualityPref
import com.streamo.app.download.DownloadQueueManager
import com.streamo.app.download.ResolveAndDownloadWorker
import com.streamo.app.provider.warp.WarpTunnel
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val backupManager: BackupManager,
    private val repository: AppRepository,
    private val settings: SettingsDataStore,
    private val warpTunnel: WarpTunnel,
    private val queueManager: DownloadQueueManager,
    @ApplicationContext private val context: Context
) : ViewModel() {

    private val _message = MutableStateFlow<String?>(null)
    val message: StateFlow<String?> = _message.asStateFlow()

    private val _stats = MutableStateFlow("")
    val stats: StateFlow<String> = _stats.asStateFlow()

    // null = non ancora caricato dal DataStore: evita il flash del default prima del valore reale
    val tmdbApiKey: StateFlow<String?> = settings.tmdbApiKey
        .stateIn(viewModelScope, SharingStarted.Eagerly, null)

    // null = non ancora caricato: il campo locale evita il flash del default.
    val providerLocale: StateFlow<String?> = settings.providerLocale
        .stateIn(viewModelScope, SharingStarted.Eagerly, null)

    private val _autoplayNext = MutableStateFlow(true)
    val autoplayNext: StateFlow<Boolean> = _autoplayNext.asStateFlow()

    private val _autoDeleteWatched = MutableStateFlow(false)
    val autoDeleteWatched: StateFlow<Boolean> = _autoDeleteWatched.asStateFlow()

    private val _showCardInfo = MutableStateFlow(true)
    val showCardInfo: StateFlow<Boolean> = _showCardInfo.asStateFlow()

    private val _reduceEffects = MutableStateFlow(false)
    val reduceEffects: StateFlow<Boolean> = _reduceEffects.asStateFlow()

    private val _accentColor = MutableStateFlow(SettingsDataStore.defaultAccent)
    val accentColor: StateFlow<Triple<Float, Float, Float>> = _accentColor.asStateFlow()

    private val _downloadQualityWifi = MutableStateFlow<DownloadQualityPref>(DownloadQualityPref.Ask)
    val downloadQualityWifi: StateFlow<DownloadQualityPref> = _downloadQualityWifi.asStateFlow()

    private val _downloadQualityMobile = MutableStateFlow<DownloadQualityPref>(DownloadQualityPref.Ask)
    val downloadQualityMobile: StateFlow<DownloadQualityPref> = _downloadQualityMobile.asStateFlow()

    // Cap qualità streaming (split per rete). Token: "auto"|"max"|"1080"|"720"|"480".
    private val _streamingQualityWifi = MutableStateFlow("auto")
    val streamingQualityWifi: StateFlow<String> = _streamingQualityWifi.asStateFlow()

    private val _streamingQualityMobile = MutableStateFlow("auto")
    val streamingQualityMobile: StateFlow<String> = _streamingQualityMobile.asStateFlow()

    private val _confirmRecalc = MutableStateFlow(false)
    val confirmRecalc: StateFlow<Boolean> = _confirmRecalc.asStateFlow()

    private val _confirmRestoreStep1 = MutableStateFlow(false)
    val confirmRestoreStep1: StateFlow<Boolean> = _confirmRestoreStep1.asStateFlow()

    private val _confirmRestoreStep2 = MutableStateFlow(false)
    val confirmRestoreStep2: StateFlow<Boolean> = _confirmRestoreStep2.asStateFlow()

    private val _pendingRestoreUri = MutableStateFlow<Uri?>(null)

    // region WARP (Cloudflare IP-masking)

    /** True only when the gomobile engine (warpkit.aar) is linked. */
    val warpAvailable: Boolean = warpTunnel.isAvailable

    private val _warpEnabled = MutableStateFlow(false)
    val warpEnabled: StateFlow<Boolean> = _warpEnabled.asStateFlow()

    private val _warpRegistered = MutableStateFlow(false)
    val warpRegistered: StateFlow<Boolean> = _warpRegistered.asStateFlow()

    private val _warpBusy = MutableStateFlow(false)
    val warpBusy: StateFlow<Boolean> = _warpBusy.asStateFlow()

    /** Egress status line shown under the toggle (e.g. "WARP attivo · IP 1.2.3.4 · MXP"). */
    private val _warpStatus = MutableStateFlow<String?>(null)
    val warpStatus: StateFlow<String?> = _warpStatus.asStateFlow()

    // endregion

    val appVersion: String = BuildConfig.VERSION_NAME

    init {
        computeStats()
        viewModelScope.launch {
            settings.autoplayNext.collect { _autoplayNext.value = it }
        }
        viewModelScope.launch {
            settings.autoDeleteWatched.collect { _autoDeleteWatched.value = it }
        }
        viewModelScope.launch {
            settings.showCardInfo.collect { _showCardInfo.value = it }
        }
        viewModelScope.launch {
            settings.reduceEffects.collect { _reduceEffects.value = it }
        }
        viewModelScope.launch {
            settings.accentColor.collect { _accentColor.value = it }
        }
        viewModelScope.launch {
            settings.downloadQualityWifi.collect {
                _downloadQualityWifi.value = DownloadQualityPref.parse(it)
            }
        }
        viewModelScope.launch {
            settings.downloadQualityMobile.collect {
                _downloadQualityMobile.value = DownloadQualityPref.parse(it)
            }
        }
        viewModelScope.launch {
            settings.streamingQualityWifi.collect { _streamingQualityWifi.value = it }
        }
        viewModelScope.launch {
            settings.streamingQualityMobile.collect { _streamingQualityMobile.value = it }
        }
        viewModelScope.launch {
            settings.warpEnabled.collect { _warpEnabled.value = it }
        }
        viewModelScope.launch {
            settings.warpRegistered.collect { _warpRegistered.value = it }
        }
    }

    fun setTmdbApiKey(key: String) {
        viewModelScope.launch {
            // Salva sempre, anche vuoto: il campo locale è la fonte di verità.
            // DataStore restituisce il default solo se la chiave non è mai stata impostata (null),
            // non se è una stringa vuota — così cancellare il campo lo lascia vuoto.
            settings.setTmdbApiKey(key)
        }
    }

    fun resetTmdbApiKey() {
        viewModelScope.launch {
            settings.setTmdbApiKey(BuildConfig.DEFAULT_TMDB_API_KEY)
        }
    }

    fun setProviderLocale(value: String) {
        viewModelScope.launch {
            val trimmed = value.trim()
            if (trimmed.isNotBlank()) settings.setProviderLocale(trimmed)
        }
    }

    fun resetProviderLocale() {
        viewModelScope.launch {
            settings.setProviderLocale("it")
        }
    }

    fun setAutoplayNext(value: Boolean) {
        viewModelScope.launch {
            settings.setAutoplayNext(value)
        }
    }

    fun setAutoDeleteWatched(value: Boolean) {
        viewModelScope.launch {
            settings.setAutoDeleteWatched(value)
        }
    }

    fun setShowCardInfo(value: Boolean) {
        viewModelScope.launch {
            settings.setShowCardInfo(value)
        }
    }

    fun setReduceEffects(value: Boolean) {
        viewModelScope.launch {
            settings.setReduceEffects(value)
        }
    }

    fun setDownloadQualityWifi(pref: DownloadQualityPref) {
        viewModelScope.launch { settings.setDownloadQualityWifi(pref.serialize()) }
    }

    fun setDownloadQualityMobile(pref: DownloadQualityPref) {
        viewModelScope.launch { settings.setDownloadQualityMobile(pref.serialize()) }
    }

    fun setStreamingQualityWifi(token: String) {
        viewModelScope.launch { settings.setStreamingQualityWifi(token) }
    }

    fun setStreamingQualityMobile(token: String) {
        viewModelScope.launch { settings.setStreamingQualityMobile(token) }
    }

    // region WARP actions

    fun setWarpEnabled(value: Boolean) {
        viewModelScope.launch {
            settings.setWarpEnabled(value)
            if (!value) {
                warpTunnel.stop()
                _warpStatus.value = null
            }
            // Pause any active download whose WARP flag doesn't match the new setting,
            // so it never runs under the wrong IP path. The queue manager then starts
            // the oldest WARP-compatible pending download in its place.
            val active = repository.getActiveDownloads()
            active.filter { it.status == "downloading" || it.status == "resolving" }
                .filter { it.warpEnabled != value }
                .forEach { mismatch ->
                    ResolveAndDownloadWorker.cancel(context, mismatch.id)
                    repository.updateDownloadStatusResetSpeed(mismatch.id, "paused")
                }
            queueManager.advance()
        }
    }

    /** Register a fresh WARP account (one-time). */
    fun registerWarp() {
        if (_warpBusy.value) return
        viewModelScope.launch {
            _warpBusy.value = true
            _warpStatus.value = "Registrazione in corso…"
            try {
                warpTunnel.register()
                _warpStatus.value = "Account WARP registrato."
                _message.value = "Account WARP registrato"
            } catch (e: Exception) {
                _warpStatus.value = "Registrazione fallita: ${e.message ?: "errore"}"
                _message.value = "Registrazione WARP fallita"
            } finally {
                _warpBusy.value = false
            }
        }
    }

    /** Bring the tunnel up and fetch the Cloudflare trace to confirm egress. */
    fun verifyEgress() {
        if (_warpBusy.value) return
        if (!_warpEnabled.value) {
            _warpStatus.value = "WARP disabilitato. Attiva WARP prima di verificare."
            return
        }
        viewModelScope.launch {
            _warpBusy.value = true
            _warpStatus.value = "Verifica egress in corso…"
            try {
                if (!warpTunnel.start()) {
                    _warpStatus.value = "Tunnel WARP non pronto. Riprova tra qualche secondo."
                    return@launch
                }
                val trace = warpTunnel.trace()
                _warpStatus.value = when {
                    trace == null -> "Verifica fallita: nessuna risposta."
                    trace.warp -> "WARP attivo · IP ${trace.ip ?: "?"}${trace.colo?.let { " · $it" } ?: ""}"
                    else -> "Tunnel attivo ma WARP=off · IP ${trace.ip ?: "?"}"
                }
            } catch (e: Exception) {
                _warpStatus.value = "Verifica fallita: ${e.message ?: "errore"}"
            } finally {
                _warpBusy.value = false
            }
        }
    }

    // endregion

    fun setAccentColor(r: Float, g: Float, b: Float) {
        viewModelScope.launch {
            settings.setAccentColor(r, g, b)
        }
    }

    fun resetAccentColor() {
        viewModelScope.launch {
            val d = SettingsDataStore.defaultAccent
            settings.setAccentColor(d.first, d.second, d.third)
        }
    }

    fun export(uri: Uri) {
        viewModelScope.launch {
            val result = backupManager.export(uri)
            _message.value = if (result.isSuccess) "Esportazione completata" else "Errore esportazione"
        }
    }

    fun requestRestore(uri: Uri) {
        _pendingRestoreUri.value = uri
        _confirmRestoreStep1.value = true
    }

    fun proceedToRestoreStep2() {
        _confirmRestoreStep1.value = false
        _confirmRestoreStep2.value = true
    }

    fun cancelRestore() {
        _pendingRestoreUri.value = null
        _confirmRestoreStep1.value = false
        _confirmRestoreStep2.value = false
    }

    fun confirmRestore() {
        _confirmRestoreStep2.value = false
        val uri = _pendingRestoreUri.value ?: return
        _pendingRestoreUri.value = null
        viewModelScope.launch {
            val result = backupManager.import(uri)
            _message.value = if (result.isSuccess) "Importazione completata" else "Errore importazione"
            computeStats()
        }
    }

    fun showRecalcDialog() {
        _confirmRecalc.value = true
    }

    fun dismissRecalcDialog() {
        _confirmRecalc.value = false
    }

    fun recalculateLibrary(): Int {
        _confirmRecalc.value = false
        var removed = 0
        viewModelScope.launch {
            val watchlistIds = repository.watchlist().first().map { it.tmdbId }.toSet()
            val historyIds = repository.history().first().map { it.tmdbId }.toSet()
            val progressList = repository.progress().first()
            val toRemove = progressList.filter { it.tmdbId !in watchlistIds && it.tmdbId !in historyIds }
            toRemove.forEach {
                repository.deleteProgress(it.tmdbId)
                removed++
            }
            computeStats()
            _message.value = when {
                removed == 0 -> "Libreria già pulita"
                removed == 1 -> "Rimosso 1 titolo orfano"
                else -> "Rimossi $removed titoli orfani"
            }
        }
        return removed
    }

    fun clearMessage() {
        _message.value = null
    }

    private fun computeStats() {
        viewModelScope.launch {
            val progressList = repository.progress().first()
            val totalSeconds = progressList.sumOf { it.positionSeconds.toLong() }
            val minutes = totalSeconds / 60
            val hours = minutes / 60
            _stats.value = if (hours > 0) {
                "$hours h ${minutes % 60} min guardati"
            } else {
                "$minutes min guardati"
            }
        }
    }
}
