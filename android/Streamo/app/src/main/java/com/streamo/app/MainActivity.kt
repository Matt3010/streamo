package com.streamo.app

import android.Manifest
import android.app.PictureInPictureParams
import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.os.Build
import android.os.Bundle
import android.util.Rational
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.annotation.OptIn
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.LocalOverscrollFactory
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.windowsizeclass.ExperimentalMaterial3WindowSizeClassApi
import androidx.compose.material3.windowsizeclass.calculateWindowSizeClass
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.lifecycle.Lifecycle
import androidx.media3.common.util.UnstableApi
import dagger.hilt.android.AndroidEntryPoint
import com.streamo.app.data.preferences.SettingsDataStore
import com.streamo.app.navigation.RootTabView
import com.streamo.app.navigation.TabletRootView
import com.streamo.app.ui.common.LocalReducedEffects
import com.streamo.app.ui.common.LocalWindowSizeClass
import com.streamo.app.ui.theme.AppTheme
import com.streamo.app.ui.tv.TvRootView
import com.streamo.app.util.isTabletDevice
import com.streamo.app.util.isTvDevice
import com.streamo.app.player.PipController
import com.streamo.app.player.PlaybackSessionHolder
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    @Inject
    lateinit var settings: SettingsDataStore

    private val requestNotificationPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    @kotlin.OptIn(ExperimentalFoundationApi::class, ExperimentalMaterial3WindowSizeClassApi::class)
    @Suppress("DEPRECATION")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            requestNotificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
        enableEdgeToEdge()
        // Barra di navigazione di sistema SEMPRE opaca (nera fissa), non
        // semitrasparente. enableEdgeToEdge la rende trasparente (contenuto sotto):
        // qui la riportiamo a nero solido così resta una barra fissa fin dall'avvio,
        // identica allo stato che prima compariva solo dopo la prima riproduzione.
        // La status bar in alto resta trasparente per il bleed dell'hero.
        window.navigationBarColor = android.graphics.Color.BLACK
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            @Suppress("DEPRECATION")
            window.navigationBarDividerColor = android.graphics.Color.BLACK
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.isNavigationBarContrastEnforced = false
        }
        // API < 30: il primo dispatch delle window insets può arrivare PRIMA che
        // la ComposeView abbia agganciato il suo OnApplyWindowInsetsListener, così
        // le insets risultano 0 (la navbar glass resta incollata sopra la barra di
        // sistema) finché un relayout non le rinvia — cosa che oggi accade solo per
        // caso quando il player forza la rotazione. Forziamo un nuovo dispatch a
        // layout avvenuto, così la navbar si solleva correttamente fin dall'avvio.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            window.decorView.post {
                ViewCompat.requestApplyInsets(window.decorView)
            }
        }
        val isTv = isTvDevice()
        val deviceIsTablet = isTabletDevice()
        // TV: landscape locked. Tablet: free rotation (all directions).
        // Phone: portrait locked.
        requestedOrientation = when {
            isTv -> ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
            deviceIsTablet -> ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
            else -> ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
        }
        setContent {
            val windowSizeClass = calculateWindowSizeClass(this)
            val accent by settings.accentColor.collectAsState(initial = SettingsDataStore.defaultAccent)
            val accentColor = Color(accent.first, accent.second, accent.third)
            val reduceEffectsPref by settings.reduceEffects.collectAsState(initial = false)
            // Su device senza blur (API < 32) la modalità prestazioni è forzata: il
            // vetro sfocato non è disponibile, quindi si usa sempre la tinta piatta.
            val reduceEffects = reduceEffectsPref || !com.streamo.app.ui.common.isBlurSupported
            val provided = buildList {
                add(LocalReducedEffects provides reduceEffects)
                if (reduceEffects) add(LocalOverscrollFactory provides null)
            }.toTypedArray()
            // Tablet vs phone deve dipendere dal DEVICE (smallestScreenWidthDp,
            // stabile), NON da windowSizeClass.isTablet che riflette la larghezza
            // CORRENTE: su un telefono grande il player forza il landscape →
            // larghezza Expanded → isTablet diventerebbe true → si passerebbe da
            // RootTabView a TabletRootView, distruggendo il NavHost che ospita il
            // PlayerScreen (playback orfano nel service, UI che torna alla Home).
            val isTablet = deviceIsTablet
            AppTheme(accentColor = accentColor) {
                CompositionLocalProvider(
                    LocalWindowSizeClass provides windowSizeClass,
                    *provided
                ) {
                    Surface(
                        modifier = Modifier.fillMaxSize(),
                        color = MaterialTheme.colorScheme.background
                    ) {
                        when {
                            isTv -> TvRootView()
                            isTablet -> TabletRootView(windowSizeClass)
                            else -> RootTabView()
                        }
                    }
                }
            }
        }
    }

    /** Pressing Home while a video is playing → enter PiP instead of just backgrounding. */
    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        enterPipIfPlaying()
    }

    @OptIn(UnstableApi::class)
    private fun enterPipIfPlaying() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val player = PlaybackSessionHolder.session?.player ?: return
        if (!player.isPlaying) return
        val params = PictureInPictureParams.Builder()
            .setAspectRatio(Rational(16, 9))
            .build()
        try {
            enterPictureInPictureMode(params)
        } catch (_: Exception) {
        }
    }

    @OptIn(UnstableApi::class)
    override fun onPictureInPictureModeChanged(
        isInPictureInPictureMode: Boolean,
        newConfig: Configuration
    ) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
        PipController.inPipMode.value = isInPictureInPictureMode
        // Closing the PiP window (X) stops the Activity → lifecycle drops to CREATED
        // instead of returning to STARTED. In that case pause playback so the video
        // doesn't keep running (with audio) in the background.
        if (!isInPictureInPictureMode &&
            !lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)
        ) {
            PlaybackSessionHolder.session?.player?.pause()
        }
    }
}
