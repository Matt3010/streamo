package com.streamo.app.ui.tv.player

import android.view.LayoutInflater
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.SkipPrevious
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.media3.common.util.UnstableApi
import androidx.media3.ui.PlayerView
import com.streamo.app.ui.player.PlayerViewModel
import kotlinx.coroutines.delay

/**
 * TV Player screen. Reuses [PlayerViewModel] unchanged.
 *
 * D-pad handling at the root Box:
 * - Center/Enter/Spacebar/MediaPlayPause → toggle play/pause + show controls
 * - Right/MediaFastForward → seek forward + show controls
 * - Left/MediaRewind → seek back + show controls
 * - Up → show controls; Down → hide controls
 * - BackHandler: if controls visible → hide; else → onBack()
 * - Auto-hide controls after ~4s while playing
 *
 * Drops: PiP, DLNA cast UI, forced landscape, touch Slider.
 * Keeps: AndroidView PlayerView, FLAG_KEEP_SCREEN_ON, saveCurrentProgress in onDispose.
 */
@OptIn(UnstableApi::class)
@Composable
fun TvPlayerScreen(
    onBack: () -> Unit = {},
    viewModel: PlayerViewModel = hiltViewModel()
) {
    val isPlaying by viewModel.isPlaying.collectAsState()
    val currentPosition by viewModel.currentPosition.collectAsState()
    val duration by viewModel.duration.collectAsState()
    val buffering by viewModel.buffering.collectAsState()
    val loading by viewModel.loading.collectAsState()
    val error by viewModel.error.collectAsState()

    var controlsVisible by remember { mutableStateOf(true) }

    // Auto-hide controls after 4s while playing
    LaunchedEffect(isPlaying, controlsVisible) {
        if (isPlaying && controlsVisible) {
            delay(4000)
            controlsVisible = false
        }
    }

    val focusRequester = remember { FocusRequester() }

    LaunchedEffect(Unit) {
        focusRequester.requestFocus()
    }

    // Keep screen on while in the player; clear it and persist progress on exit.
    val context = LocalContext.current
    DisposableEffect(Unit) {
        val window = (context as? android.app.Activity)?.window
        window?.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        onDispose {
            window?.clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            viewModel.saveCurrentProgress()
        }
    }

    BackHandler {
        if (controlsVisible) {
            controlsVisible = false
        } else {
            viewModel.saveCurrentProgress()
            onBack()
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black)
            .focusRequester(focusRequester)
            .focusable()
            .onPreviewKeyEvent { event ->
                val keyEvent = event.nativeKeyEvent
                if (keyEvent.action != android.view.KeyEvent.ACTION_DOWN) return@onPreviewKeyEvent false
                when (keyEvent.keyCode) {
                    android.view.KeyEvent.KEYCODE_DPAD_CENTER,
                    android.view.KeyEvent.KEYCODE_ENTER,
                    android.view.KeyEvent.KEYCODE_SPACE -> {
                        viewModel.togglePlayPause()
                        controlsVisible = true
                        true
                    }
                    android.view.KeyEvent.KEYCODE_DPAD_RIGHT -> {
                        viewModel.seekForward()
                        controlsVisible = true
                        true
                    }
                    android.view.KeyEvent.KEYCODE_DPAD_LEFT -> {
                        viewModel.seekBack()
                        controlsVisible = true
                        true
                    }
                    android.view.KeyEvent.KEYCODE_DPAD_UP -> {
                        controlsVisible = true
                        true
                    }
                    android.view.KeyEvent.KEYCODE_DPAD_DOWN -> {
                        controlsVisible = false
                        true
                    }
                    android.view.KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> {
                        viewModel.togglePlayPause()
                        controlsVisible = true
                        true
                    }
                    android.view.KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> {
                        viewModel.seekForward()
                        controlsVisible = true
                        true
                    }
                    android.view.KeyEvent.KEYCODE_MEDIA_REWIND -> {
                        viewModel.seekBack()
                        controlsVisible = true
                        true
                    }
                    else -> false
                }
            }
    ) {
        // PlayerView — useController=false (custom overlay)
        AndroidView(
            factory = { ctx ->
                val playerView = LayoutInflater.from(ctx).inflate(com.streamo.app.R.layout.view_player, null) as PlayerView
                playerView.player = viewModel.player
                playerView.useController = false
                playerView
            },
            modifier = Modifier.fillMaxSize()
        )

        // Buffering indicator
        if (buffering || loading) {
            CircularProgressIndicator(
                modifier = Modifier.align(Alignment.Center),
                color = Color.White
            )
        }

        // Error overlay
        error?.let { errorMsg ->
            Column(
                modifier = Modifier
                    .align(Alignment.Center)
                    .padding(32.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Text(
                    text = errorMsg,
                    color = Color.White,
                    style = MaterialTheme.typography.bodyLarge
                )
            }
        }

        // Controls overlay
        AnimatedVisibility(
            visible = controlsVisible,
            enter = fadeIn(tween(200)),
            exit = fadeOut(tween(200)),
            modifier = Modifier.align(Alignment.BottomCenter)
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Color.Black.copy(alpha = 0.7f))
                    .padding(horizontal = 24.dp, vertical = 16.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                // Title
                Text(
                    text = viewModel.title,
                    color = Color.White,
                    style = MaterialTheme.typography.titleMedium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )

                Spacer(modifier = Modifier.height(8.dp))

                // Progress bar (read-only Canvas)
                val progressFraction = if (duration > 0L) (currentPosition.toFloat() / duration) else 0f
                val progressColor = MaterialTheme.colorScheme.primary
                Canvas(modifier = Modifier.fillMaxWidth().height(4.dp)) {
                    drawRect(color = Color.White.copy(alpha = 0.3f))
                    drawRect(
                        color = progressColor,
                        size = Size(size.width * progressFraction, size.height)
                    )
                }

                Spacer(modifier = Modifier.height(8.dp))

                // Playback controls
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.Center
                ) {
                    IconButton(onClick = { viewModel.seekBack() }) {
                        Icon(Icons.Filled.SkipPrevious, "Indietro", tint = Color.White, modifier = Modifier.size(36.dp))
                    }
                    Spacer(modifier = Modifier.width(16.dp))
                    IconButton(onClick = { viewModel.togglePlayPause() }) {
                        Icon(
                            if (isPlaying) Icons.Filled.Pause else Icons.Filled.PlayArrow,
                            if (isPlaying) "Pausa" else "Riproduci",
                            tint = Color.White,
                            modifier = Modifier.size(48.dp)
                        )
                    }
                    Spacer(modifier = Modifier.width(16.dp))
                    IconButton(onClick = { viewModel.seekForward() }) {
                        Icon(Icons.Filled.SkipNext, "Avanti", tint = Color.White, modifier = Modifier.size(36.dp))
                    }
                }

                // Time display
                Text(
                    text = "${formatTime(currentPosition)} / ${formatTime(duration)}",
                    color = Color.White.copy(alpha = 0.7f),
                    style = MaterialTheme.typography.bodySmall
                )
            }
        }
    }
}

private fun formatTime(ms: Long): String {
    val totalSeconds = (ms / 1000).toInt().coerceAtLeast(0)
    val h = totalSeconds / 3600
    val m = (totalSeconds % 3600) / 60
    val s = totalSeconds % 60
    return if (h > 0) "$h:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}" else "$m:${s.toString().padStart(2, '0')}"
}