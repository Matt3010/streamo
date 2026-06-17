package com.streamo.app.ui.tv.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Switch
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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.hilt.navigation.compose.hiltViewModel
import com.streamo.app.BuildConfig
import com.streamo.app.R
import com.streamo.app.ui.common.AmbientBackground
import com.streamo.app.ui.settings.SettingsViewModel
import com.streamo.app.ui.tv.common.TvFocusable

/**
 * TV Settings screen — D-pad focusable list of settings, each row showing a clear
 * focus highlight. Reuses [SettingsViewModel] unchanged. Downloads section hidden on TV.
 */
@Composable
fun TvSettingsScreen(
    onNavigateToDebugLogs: () -> Unit = {},
    viewModel: SettingsViewModel = hiltViewModel()
) {
    val autoplayNext by viewModel.autoplayNext.collectAsState()
    val streamingQuality by viewModel.streamingQualityWifi.collectAsState()
    val warpEnabled by viewModel.warpEnabled.collectAsState()
    val warpRegistered by viewModel.warpRegistered.collectAsState()
    val warpBusy by viewModel.warpBusy.collectAsState()
    val warpStatus by viewModel.warpStatus.collectAsState()
    val stats by viewModel.stats.collectAsState()
    val message by viewModel.message.collectAsState()
    val confirmRecalc by viewModel.confirmRecalc.collectAsState()

    var showStreamingPicker by remember { mutableStateOf(false) }

    val initialFocusRequester = remember { FocusRequester() }

    LaunchedEffect(Unit) {
        runCatching { initialFocusRequester.requestFocus() }
    }

    AmbientBackground()

    // Streaming quality picker dialog
    if (showStreamingPicker) {
        TvSettingsDialog(
            title = "Qualità streaming",
            onDismiss = { showStreamingPicker = false }
        ) {
            val options = listOf(
                "auto" to "Auto",
                "max" to "Massima",
                "1080" to "1080p",
                "720" to "720p",
                "480" to "480p"
            )
            options.forEach { (token, label) ->
                val selected = streamingQuality == token
                TvFocusable(
                    onClick = {
                        viewModel.setStreamingQualityWifi(token)
                        showStreamingPicker = false
                    },
                    modifier = Modifier.fillMaxWidth()
                ) { focused ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(8.dp))
                            .background(if (focused) Color.White.copy(alpha = 0.12f) else Color.Transparent)
                            .padding(horizontal = 16.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        RadioButton(selected = selected, onClick = null)
                        Text(
                            text = label,
                            style = MaterialTheme.typography.bodyLarge,
                            color = if (focused) Color.White else MaterialTheme.colorScheme.onBackground
                        )
                    }
                }
            }
        }
    }

    // Recalc library confirmation dialog
    if (confirmRecalc) {
        TvSettingsDialog(
            title = "Ricalcolare la libreria?",
            onDismiss = { viewModel.dismissRecalcDialog() }
        ) {
            Text(
                text = "Elimina i progressi dei titoli non più in cronologia né in lista. La cronologia e la lista non vengono toccate.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(bottom = 16.dp)
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                TvFocusable(
                    onClick = { viewModel.dismissRecalcDialog() },
                    modifier = Modifier.weight(1f)
                ) { focused ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(8.dp))
                            .background(if (focused) Color.White.copy(alpha = 0.12f) else Color.White.copy(alpha = 0.06f))
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
                    onClick = { viewModel.recalculateLibrary() },
                    modifier = Modifier.weight(1f)
                ) { focused ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(8.dp))
                            .background(if (focused) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.error.copy(alpha = 0.7f))
                            .padding(vertical = 12.dp),
                        horizontalArrangement = Arrangement.Center
                    ) {
                        Text(
                            text = "Ricalcola",
                            style = MaterialTheme.typography.titleSmall,
                            color = Color.White
                        )
                    }
                }
            }
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 48.dp, vertical = 24.dp)
            .verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Text(
            text = "Impostazioni",
            style = MaterialTheme.typography.headlineMedium,
            color = MaterialTheme.colorScheme.onBackground,
            modifier = Modifier.padding(bottom = 8.dp)
        )

        // ————————————————————————————
        // 1. Riproduzione
        // ————————————————————————————
        SectionHeader("Riproduzione")

        SettingsToggleRow(
            label = "Riproduzione automatica prossimo episodio",
            checked = autoplayNext,
            onToggle = { viewModel.setAutoplayNext(it) },
            focusRequester = initialFocusRequester
        )

        SettingsValueRow(
            label = "Qualità streaming",
            value = streamingQualityLabel(streamingQuality),
            onClick = { showStreamingPicker = true }
        )

        // ————————————————————————————
        // 2. Rete e privacy
        // ————————————————————————————
        Spacer(modifier = Modifier.height(8.dp))
        SectionHeader("Rete e privacy")

        if (!viewModel.warpAvailable) {
            Text(
                text = "Motore WARP non incluso in questa build (warpkit.aar).",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.padding(horizontal = 16.dp)
            )
        } else {
            if (warpRegistered) {
                SettingsToggleRow(
                    label = "Maschera IP (WARP)",
                    subtitle = "Instrada il traffico attraverso Cloudflare WARP",
                    checked = warpEnabled,
                    onToggle = { viewModel.setWarpEnabled(it) }
                )
            }
            SettingsValueRow(
                label = if (warpRegistered) "Rigenera account WARP" else "Registra account WARP",
                value = if (warpBusy) "…" else if (warpRegistered) "Registrato" else "Non registrato",
                onClick = { viewModel.registerWarp() }
            )
            if (warpRegistered) {
                SettingsValueRow(
                    label = "Verifica egress",
                    value = if (warpBusy) "…" else "Premi per verificare",
                    enabled = warpEnabled,
                    onClick = { viewModel.verifyEgress() }
                )
            }
            warpStatus?.let { status ->
                Text(
                    text = status,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 16.dp)
                )
            }
        }

        // ————————————————————————————
        // 3. Manutenzione
        // ————————————————————————————
        Spacer(modifier = Modifier.height(8.dp))
        SectionHeader("Manutenzione")

        SettingsValueRow(
            label = "Ricalcola libreria",
            value = "Rimuove progressi orfani",
            onClick = { viewModel.showRecalcDialog() }
        )

        if (stats.isNotBlank()) {
            Text(
                text = stats,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp)
            )
        }

        // ————————————————————————————
        // 4. Informazioni
        // ————————————————————————————
        Spacer(modifier = Modifier.height(8.dp))
        SectionHeader("Informazioni")

        SettingsValueRow(
            label = "Versione",
            value = if (BuildConfig.DEBUG) "${BuildConfig.VERSION_NAME} >" else BuildConfig.VERSION_NAME,
            onClick = { if (BuildConfig.DEBUG) onNavigateToDebugLogs() }
        )

        if (message != null) {
            Text(
                text = message!!,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.padding(horizontal = 16.dp)
            )
        }

        // TMDB attribution
        Spacer(modifier = Modifier.height(8.dp))
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Image(
                painter = painterResource(id = R.drawable.tmdb_logo),
                contentDescription = "TMDB",
                contentScale = ContentScale.Fit,
                modifier = Modifier
                    .width(200.dp)
                    .height(16.dp)
            )
        }
        Text(
            text = "Questa applicazione utilizza TMDB e le API di TMDB ma non è approvata, certificata o in alcun modo autorizzata da TMDB.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = 16.dp)
        )

        Spacer(modifier = Modifier.height(24.dp))
    }
}

private fun streamingQualityLabel(token: String): String = when (token) {
    "max" -> "Massima"
    "1080" -> "1080p"
    "720" -> "720p"
    "480" -> "480p"
    else -> "Auto"
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
    focusRequester: FocusRequester? = null,
    onClick: () -> Unit
) {
    val alpha = if (enabled) 1f else 0.38f
    TvFocusable(
        onClick = { if (enabled) onClick() },
        focusRequester = focusRequester,
        modifier = Modifier.fillMaxWidth()
    ) { focused ->
        RowContent(focused = focused) {
            Text(
                text = label,
                style = MaterialTheme.typography.bodyLarge,
                color = (if (focused) Color.White else MaterialTheme.colorScheme.onBackground).copy(alpha = alpha)
            )
            Text(
                text = value,
                style = MaterialTheme.typography.bodyMedium,
                color = (if (focused) Color.White.copy(alpha = 0.8f)
                else MaterialTheme.colorScheme.onSurfaceVariant).copy(alpha = alpha)
            )
        }
    }
}

@Composable
private fun SettingsToggleRow(
    label: String,
    subtitle: String? = null,
    checked: Boolean,
    onToggle: (Boolean) -> Unit,
    focusRequester: FocusRequester? = null
) {
    TvFocusable(
        onClick = { onToggle(!checked) },
        focusRequester = focusRequester,
        modifier = Modifier.fillMaxWidth()
    ) { focused ->
        RowContent(focused = focused) {
            Column(modifier = Modifier.fillMaxWidth(0.85f)) {
                Text(
                    text = label,
                    style = MaterialTheme.typography.bodyLarge,
                    color = if (focused) Color.White else MaterialTheme.colorScheme.onBackground
                )
                if (subtitle != null) {
                    Text(
                        text = subtitle,
                        style = MaterialTheme.typography.bodySmall,
                        color = if (focused) Color.White.copy(alpha = 0.7f) else MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
            Switch(checked = checked, onCheckedChange = null)
        }
    }
}

@Composable
private fun RowContent(
    focused: Boolean,
    content: @Composable () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(if (focused) Color.White.copy(alpha = 0.12f) else Color.Transparent)
            .padding(horizontal = 16.dp, vertical = 14.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
        content = { content() }
    )
}

@Composable
private fun TvSettingsDialog(
    title: String,
    onDismiss: () -> Unit,
    content: @Composable () -> Unit
) {
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
            content()
        }
    }
}
