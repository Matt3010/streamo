package com.streamo.app.ui.settings

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.streamo.app.navigation.LocalBottomBarPadding
import com.streamo.app.provider.ProviderDebugLogger
import com.streamo.app.ui.common.BrandButton
import com.streamo.app.ui.common.GlassLargeTitle
import com.streamo.app.ui.common.GlassTopBarScaffold
import com.streamo.app.ui.theme.AppShapes
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LogViewerScreen(
    onBack: () -> Unit = {}
) {
    val context = LocalContext.current
    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    var logs by remember { mutableStateOf(ProviderDebugLogger.getLogs()) }

    Box(modifier = Modifier.fillMaxSize()) {
    GlassTopBarScaffold(
        onLeading = onBack
    ) { topPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(
                    start = 16.dp,
                    top = topPadding + 16.dp,
                    end = 16.dp,
                    bottom = 16.dp + LocalBottomBarPadding.current
                ),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            GlassLargeTitle("Log di debug")
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                BrandButton(
                    onClick = {
                        val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                        clipboard.setPrimaryClip(ClipData.newPlainText("Streamo Logs", logs))
                        scope.launch {
                            snackbarHostState.showSnackbar("Log copiati negli appunti")
                        }
                    },
                    modifier = Modifier.weight(1f)
                ) { Text("Copia") }
                BrandButton(
                    onClick = {
                        ProviderDebugLogger.clear()
                        logs = ""
                        scope.launch {
                            snackbarHostState.showSnackbar("Log cancellati")
                        }
                    },
                    modifier = Modifier.weight(1f)
                ) { Text("Pulisci") }
                BrandButton(
                    onClick = { logs = ProviderDebugLogger.getLogs() },
                    modifier = Modifier.weight(1f)
                ) { Text("Aggiorna") }
            }

            Spacer(modifier = Modifier.height(4.dp))

            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .clip(AppShapes.sm)
                    .background(Color.White.copy(alpha = 0.05f))
                    .verticalScroll(rememberScrollState())
                    .horizontalScroll(rememberScrollState())
                    .padding(12.dp)
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
                        fontSize = 11.sp,
                        color = Color.White.copy(alpha = 0.9f),
                        lineHeight = 16.sp
                    )
                }
            }
        }
    }
        SnackbarHost(
            snackbarHostState,
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(bottom = LocalBottomBarPadding.current)
        )
    }
}
