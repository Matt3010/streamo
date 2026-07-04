package com.streamo.app.navigation

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Cast
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.streamo.app.ui.common.DialogHostState
import com.streamo.app.ui.common.GlassAlertDialog
import com.streamo.app.ui.common.GlassDefaults
import com.streamo.app.ui.common.GlassDialogDestructiveButton
import com.streamo.app.ui.common.GlassDialogNeutralButton
import com.streamo.app.ui.common.LocalDialogHost
import com.streamo.app.ui.common.LocalHazeState
import com.streamo.app.ui.common.glassCapsule
import dev.chrisbanes.haze.HazeState

/**
 * Banner "trasmissione in corso" — pillola glass cliccabile per tornare ai
 * controlli, con play/pausa e stop rapido. Condiviso fra telefono
 * ([RootTabView]), tablet portrait e landscape ([TabletRootView]): stesso
 * look & feel, un solo posto da cambiare.
 */
@Composable
internal fun CastBanner(
    hazeState: HazeState,
    dialogHost: DialogHostState,
    title: String,
    tvName: String,
    isPlaying: Boolean,
    onClick: () -> Unit,
    onTogglePlay: () -> Unit,
    onStop: () -> Unit,
    modifier: Modifier = Modifier
) {
    var showStopConfirm by remember { mutableStateOf(false) }
    Box(
        modifier = modifier
            .fillMaxWidth()
            .glassCapsule(hazeState, GlassDefaults.Shape)
    ) {
        Row(
            modifier = Modifier
                .clickable(onClick = onClick)
                .padding(start = 14.dp, top = 8.dp, bottom = 8.dp, end = 4.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = Icons.Filled.Cast,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary
            )
            Spacer(modifier = Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = title,
                    color = Color.White,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 14.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    text = "Trasmissione su $tvName",
                    color = Color.White.copy(alpha = 0.65f),
                    fontSize = 12.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
            IconButton(onClick = onTogglePlay) {
                Icon(
                    imageVector = if (isPlaying) Icons.Filled.Pause else Icons.Filled.PlayArrow,
                    contentDescription = if (isPlaying) "Pausa" else "Riprendi",
                    tint = Color.White
                )
            }
            IconButton(onClick = { showStopConfirm = true }) {
                Icon(
                    imageVector = Icons.Filled.Close,
                    contentDescription = "Interrompi",
                    tint = Color.White
                )
            }
        }
    }

    if (showStopConfirm) {
        CompositionLocalProvider(
            LocalHazeState provides hazeState,
            LocalDialogHost provides dialogHost
        ) {
            GlassAlertDialog(
                onDismissRequest = { showStopConfirm = false },
                title = "Interrompi trasmissione",
                text = { Text("Vuoi interrompere la trasmissione su $tvName?") },
                confirmButton = {
                    GlassDialogDestructiveButton(
                        onClick = {
                            showStopConfirm = false
                            onStop()
                        }
                    ) {
                        Text("Interrompi")
                    }
                },
                dismissButton = {
                    GlassDialogNeutralButton(onClick = { showStopConfirm = false }) {
                        Text("Annulla")
                    }
                }
            )
        }
    }
}
