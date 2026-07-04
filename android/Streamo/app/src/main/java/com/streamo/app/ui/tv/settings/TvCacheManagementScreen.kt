package com.streamo.app.ui.tv.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.streamo.app.ui.common.AmbientBackground
import com.streamo.app.ui.downloads.formatBytes
import com.streamo.app.ui.tv.common.TvFocusable
import com.streamo.app.ui.tv.common.tvFocusRing

/**
 * TV "Spazio e cache" — sezione dedicata (non più singola riga in TvSettings).
 * Mostra le 4 categorie (metadati TMDB, immagini, streaming, svuota tutto) con
 * dimensioni e azione "Svuota" per ognuna. D-pad navigabile, conferme in dialog
 * (Annulla = onSurfaceVariant, distruttivo = error).
 */
@Composable
fun TvCacheManagementScreen(
    onBack: () -> Unit = {},
    viewModel: TvCacheManagementViewModel = hiltViewModel()
) {
    val streamingBytes by viewModel.streamingBytes.collectAsState()
    val tmdbBytes by viewModel.tmdbBytes.collectAsState()
    val tmdbCount by viewModel.tmdbCount.collectAsState()
    val imageBytes by viewModel.imageBytes.collectAsState()
    val imageMaxBytes by viewModel.imageMaxBytes.collectAsState()

    var confirmStreaming by remember { mutableStateOf(false) }
    var confirmTmdb by remember { mutableStateOf(false) }
    var confirmImages by remember { mutableStateOf(false) }
    var confirmAll by remember { mutableStateOf(false) }

    val initialFocusRequester = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { initialFocusRequester.requestFocus() } }

    AmbientBackground()

    ConfirmDialog(
        visible = confirmStreaming,
        title = "Svuotare la cache streaming?",
        body = "Verranno rimossi i segmenti della riproduzione online (${formatBytes(streamingBytes)}).",
        confirmLabel = "Svuota",
        onDismiss = { confirmStreaming = false },
        onConfirm = { viewModel.clearStreamingCache(); confirmStreaming = false }
    )
    ConfirmDialog(
        visible = confirmTmdb,
        title = "Svuotare la cache metadati?",
        body = "Verranno rimosse $tmdbCount voci TMDB (${formatBytes(tmdbBytes)}). Riscaricate al primo accesso online.",
        confirmLabel = "Svuota",
        onDismiss = { confirmTmdb = false },
        onConfirm = { viewModel.clearTmdbCache(); confirmTmdb = false }
    )
    ConfirmDialog(
        visible = confirmImages,
        title = "Svuotare la cache immagini?",
        body = "Verranno rimossi poster e backdrop (${formatBytes(imageBytes)}). Riscaricati al prossimo caricamento.",
        confirmLabel = "Svuota",
        onDismiss = { confirmImages = false },
        onConfirm = { viewModel.clearImageCache(); confirmImages = false }
    )
    ConfirmDialog(
        visible = confirmAll,
        title = "Svuotare tutta la cache?",
        body = "Streaming (${formatBytes(streamingBytes)}), metadati TMDB (${formatBytes(tmdbBytes)}) e immagini (${formatBytes(imageBytes)}). I download non sono toccati.",
        confirmLabel = "Svuota tutto",
        onDismiss = { confirmAll = false },
        onConfirm = { viewModel.clearAllCaches(); confirmAll = false }
    )

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 48.dp, vertical = 24.dp)
            .verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Text(
            text = "Spazio e cache",
            style = MaterialTheme.typography.headlineMedium,
            color = MaterialTheme.colorScheme.onBackground,
            modifier = Modifier.padding(bottom = 8.dp)
        )

        SettingsValueRow(
            label = "Indietro",
            value = "",
            focusRequester = initialFocusRequester,
            onClick = onBack
        )

        SectionHeader("Metadati (TMDB)")
        SettingsValueRow(
            label = "Cache metadati",
            value = "${formatBytes(tmdbBytes)} · $tmdbCount voci",
            onClick = { if (tmdbBytes > 0L || tmdbCount > 0) confirmTmdb = true }
        )

        Spacer(modifier = Modifier.height(8.dp))
        SectionHeader("Immagini")
        SettingsValueRow(
            label = "Cache immagini",
            value = "${formatBytes(imageBytes)} / ${formatBytes(imageMaxBytes)}",
            onClick = { if (imageBytes > 0L) confirmImages = true }
        )

        Spacer(modifier = Modifier.height(8.dp))
        SectionHeader("Streaming")
        SettingsValueRow(
            label = "Cache streaming",
            value = formatBytes(streamingBytes),
            onClick = { if (streamingBytes > 0L) confirmStreaming = true }
        )

        Spacer(modifier = Modifier.height(8.dp))
        SectionHeader("Generale")
        SettingsValueRow(
            label = "Svuota tutta la cache",
            value = "Streaming + immagini + metadati",
            destructive = true,
            onClick = { confirmAll = true }
        )

        Spacer(modifier = Modifier.height(24.dp))
    }
}

@Composable
private fun SectionHeader(title: String) {
    Text(
        text = title,
        style = MaterialTheme.typography.titleMedium,
        color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.padding(start = 16.dp, top = 4.dp, bottom = 4.dp)
    )
}

@Composable
private fun SettingsValueRow(
    label: String,
    value: String,
    enabled: Boolean = true,
    destructive: Boolean = false,
    focusRequester: FocusRequester? = null,
    onClick: () -> Unit
) {
    val alpha = if (enabled) 1f else 0.38f
    TvFocusable(
        onClick = { if (enabled) onClick() },
        focusRequester = focusRequester,
        modifier = Modifier.fillMaxWidth()
    ) { focused ->
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(10.dp))
                .background(if (focused) Color.White.copy(alpha = 0.12f) else Color.Transparent)
                .tvFocusRing(focused, RoundedCornerShape(10.dp))
                .padding(horizontal = 16.dp, vertical = 14.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = label,
                style = MaterialTheme.typography.bodyLarge,
                color = (if (focused) Color.White else MaterialTheme.colorScheme.onBackground).copy(alpha = alpha)
            )
            if (value.isNotEmpty()) {
                Text(
                    text = value,
                    style = MaterialTheme.typography.bodyMedium,
                    color = when {
                        destructive && focused -> MaterialTheme.colorScheme.error
                        destructive -> MaterialTheme.colorScheme.error.copy(alpha = 0.85f)
                        focused -> Color.White.copy(alpha = 0.8f)
                        else -> MaterialTheme.colorScheme.onSurfaceVariant
                    }.copy(alpha = alpha)
                )
            }
        }
    }
}

@Composable
private fun ConfirmDialog(
    visible: Boolean,
    title: String,
    body: String,
    confirmLabel: String,
    onDismiss: () -> Unit,
    onConfirm: () -> Unit
) {
    if (!visible) return
    androidx.compose.ui.window.Dialog(onDismissRequest = onDismiss) {
        Column(
            modifier = Modifier
                .widthIn(min = 400.dp, max = 600.dp)
                .clip(RoundedCornerShape(16.dp))
                .background(Color(0xFF1A1A1A))
                .padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Text(
                text = title,
                style = MaterialTheme.typography.titleLarge,
                color = MaterialTheme.colorScheme.onBackground,
                modifier = Modifier.padding(bottom = 8.dp)
            )
            Text(
                text = body,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(bottom = 16.dp)
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                TvFocusable(
                    onClick = onDismiss,
                    modifier = Modifier.weight(1f)
                ) { focused ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(8.dp))
                            .background(if (focused) Color.White.copy(alpha = 0.12f) else Color.White.copy(alpha = 0.06f))
                            .tvFocusRing(focused, RoundedCornerShape(8.dp))
                            .padding(vertical = 12.dp),
                        horizontalArrangement = Arrangement.Center
                    ) {
                        Text(
                            text = "Annulla",
                            style = MaterialTheme.typography.titleSmall,
                            color = if (focused) Color.White else MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
                TvFocusable(
                    onClick = onConfirm,
                    modifier = Modifier.weight(1f)
                ) { focused ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(8.dp))
                            .background(if (focused) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.error.copy(alpha = 0.7f))
                            .tvFocusRing(focused, RoundedCornerShape(8.dp))
                            .padding(vertical = 12.dp),
                        horizontalArrangement = Arrangement.Center
                    ) {
                        Text(
                            text = confirmLabel,
                            style = MaterialTheme.typography.titleSmall,
                            color = Color.White
                        )
                    }
                }
            }
        }
    }
}