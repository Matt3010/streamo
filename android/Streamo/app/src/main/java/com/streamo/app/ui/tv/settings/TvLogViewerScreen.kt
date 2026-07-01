package com.streamo.app.ui.tv.settings

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.streamo.app.provider.ProviderDebugLogger
import com.streamo.app.ui.common.AmbientBackground
import com.streamo.app.ui.tv.common.TvFocusable
import com.streamo.app.ui.tv.common.tvFocusRing
import kotlinx.coroutines.launch

@Composable
fun TvLogViewerScreen(
    onBack: () -> Unit = {}
) {
    val context = LocalContext.current
    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    var logs by remember { mutableStateOf(ProviderDebugLogger.getLogs()) }
    val initialFocusRequester = remember { FocusRequester() }

    LaunchedEffect(Unit) {
        runCatching { initialFocusRequester.requestFocus() }
    }

    AmbientBackground()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 48.dp, vertical = 24.dp)
    ) {
        Text(
            text = "Log di debug",
            style = MaterialTheme.typography.headlineMedium,
            color = MaterialTheme.colorScheme.onBackground,
            modifier = Modifier.padding(bottom = 16.dp)
        )

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            TvFocusable(
                onClick = {
                    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                    clipboard.setPrimaryClip(ClipData.newPlainText("Streamo Logs", logs))
                    scope.launch {
                        snackbarHostState.showSnackbar("Log copiati negli appunti")
                    }
                },
                focusRequester = initialFocusRequester
            ) { focused ->
                TvButton(text = "Copia", focused = focused)
            }
            TvFocusable(
                onClick = {
                    ProviderDebugLogger.clear()
                    logs = ""
                    scope.launch {
                        snackbarHostState.showSnackbar("Log cancellati")
                    }
                }
            ) { focused ->
                TvButton(text = "Pulisci", focused = focused)
            }
            TvFocusable(
                onClick = { logs = ProviderDebugLogger.getLogs() }
            ) { focused ->
                TvButton(text = "Aggiorna", focused = focused)
            }
            TvFocusable(
                onClick = onBack
            ) { focused ->
                TvButton(text = "Indietro", focused = focused)
            }
        }

        Spacer(modifier = Modifier.height(16.dp))

        Column(
            modifier = Modifier
                .fillMaxSize()
                .clip(RoundedCornerShape(8.dp))
                .background(Color.White.copy(alpha = 0.05f))
                .verticalScroll(rememberScrollState())
                .horizontalScroll(rememberScrollState())
                .padding(16.dp)
        ) {
            if (logs.isBlank()) {
                Text(
                    text = "Nessun log disponibile.\nAvvia una riproduzione per generare log.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            } else {
                Text(
                    text = logs,
                    fontFamily = FontFamily.Monospace,
                    fontSize = 14.sp,
                    color = Color.White.copy(alpha = 0.9f),
                    lineHeight = 20.sp
                )
            }
        }

        SnackbarHost(snackbarHostState)
    }
}

@Composable
private fun TvButton(text: String, focused: Boolean) {
    Text(
        text = text,
        style = MaterialTheme.typography.titleSmall,
        color = if (focused) Color.White else MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier
            .clip(RoundedCornerShape(8.dp))
            .background(if (focused) Color.White.copy(alpha = 0.15f) else Color.White.copy(alpha = 0.06f))
            .tvFocusRing(focused, RoundedCornerShape(8.dp))
            .padding(horizontal = 24.dp, vertical = 12.dp)
    )
}
