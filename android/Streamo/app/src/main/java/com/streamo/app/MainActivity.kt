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
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.media3.common.util.UnstableApi
import com.streamo.app.player.PipController
import com.streamo.app.player.PlaybackSessionHolder
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.LocalOverscrollFactory
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import com.streamo.app.data.preferences.SettingsDataStore
import com.streamo.app.navigation.RootTabView
import com.streamo.app.ui.common.LocalReducedEffects
import com.streamo.app.ui.theme.AppTheme
import com.streamo.app.ui.tv.TvRootView
import com.streamo.app.util.isTvDevice
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    @Inject
    lateinit var settings: SettingsDataStore

    private val requestNotificationPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    @OptIn(ExperimentalFoundationApi::class)
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Android 13+: notifications (media playback + download status) need runtime grant.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            requestNotificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
        enableEdgeToEdge()
        val isTv = isTvDevice()
        // Orientamento per form factor: telefono bloccato in portrait, TV in landscape
        // (il lock portrait nel manifest stirerebbe la UI TV). Il player phone cambia
        // requestedOrientation a runtime, sovrascrivendo questo default quando serve.
        requestedOrientation = if (isTv) {
            ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
        } else {
            ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
        }
        setContent {
            val accent by settings.accentColor.collectAsState(initial = SettingsDataStore.defaultAccent)
            val accentColor = Color(accent.first, accent.second, accent.third)
            val reduceEffects by settings.reduceEffects.collectAsState(initial = false)
            // In modalità prestazioni togliamo anche l'effetto overscroll (lo
            // stretch/glow animato dello scroll), oltre a blur e animazioni glass.
            val provided = buildList {
                add(LocalReducedEffects provides reduceEffects)
                if (reduceEffects) add(LocalOverscrollFactory provides null)
            }.toTypedArray()
            AppTheme(accentColor = accentColor) {
                CompositionLocalProvider(*provided) {
                    Surface(
                        modifier = Modifier.fillMaxSize(),
                        color = MaterialTheme.colorScheme.background
                    ) {
                        if (isTv) TvRootView() else RootTabView()
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
