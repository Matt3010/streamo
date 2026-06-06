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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.streamo.app.ui.common.AmbientBackground
import com.streamo.app.ui.settings.SettingsViewModel
import com.streamo.app.ui.tv.common.TvFocusable

/**
 * TV Settings screen — D-pad focusable list of settings, each row showing a clear
 * focus highlight. Reuses [SettingsViewModel] unchanged. Downloads section hidden on TV.
 */
@Composable
fun TvSettingsScreen(
    viewModel: SettingsViewModel = hiltViewModel()
) {
    val tmdbApiKey by viewModel.tmdbApiKey.collectAsState()
    val autoplayNext by viewModel.autoplayNext.collectAsState()
    val autoDeleteWatched by viewModel.autoDeleteWatched.collectAsState()
    val stats by viewModel.stats.collectAsState()
    val message by viewModel.message.collectAsState()

    val initialFocusRequester = remember { FocusRequester() }

    LaunchedEffect(Unit) {
        runCatching { initialFocusRequester.requestFocus() }
    }

    AmbientBackground()

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

        SettingsValueRow(
            label = "Chiave API TMDB",
            value = tmdbApiKey?.takeIf { it.isNotBlank() } ?: "(predefinita)",
            focusRequester = initialFocusRequester,
            onClick = { /* editing via remote IME can be added later */ }
        )

        SettingsToggleRow(
            label = "Riproduzione automatica prossimo episodio",
            checked = autoplayNext,
            onToggle = { viewModel.setAutoplayNext(it) }
        )

        SettingsToggleRow(
            label = "Elimina automaticamente dopo visione",
            checked = autoDeleteWatched,
            onToggle = { viewModel.setAutoDeleteWatched(it) }
        )

        if (stats.isNotBlank()) {
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = stats,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }

        if (message != null) {
            Text(
                text = message!!,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.primary
            )
        }
    }
}

@Composable
private fun SettingsValueRow(
    label: String,
    value: String,
    focusRequester: FocusRequester? = null,
    onClick: () -> Unit
) {
    TvFocusable(
        onClick = onClick,
        focusRequester = focusRequester,
        modifier = Modifier.fillMaxWidth()
    ) { focused ->
        RowContent(focused = focused) {
            Text(
                text = label,
                style = MaterialTheme.typography.bodyLarge,
                color = if (focused) Color.White else MaterialTheme.colorScheme.onBackground
            )
            Text(
                text = value,
                style = MaterialTheme.typography.bodyMedium,
                color = if (focused) Color.White.copy(alpha = 0.8f)
                else MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

@Composable
private fun SettingsToggleRow(
    label: String,
    checked: Boolean,
    onToggle: (Boolean) -> Unit
) {
    TvFocusable(
        onClick = { onToggle(!checked) },
        modifier = Modifier.fillMaxWidth()
    ) { focused ->
        RowContent(focused = focused) {
            Text(
                text = label,
                style = MaterialTheme.typography.bodyLarge,
                color = if (focused) Color.White else MaterialTheme.colorScheme.onBackground,
                modifier = Modifier.fillMaxWidth(0.85f)
            )
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
