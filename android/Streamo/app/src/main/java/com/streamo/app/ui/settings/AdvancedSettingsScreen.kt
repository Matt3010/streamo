package com.streamo.app.ui.settings

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.streamo.app.BuildConfig
import com.streamo.app.navigation.LocalBottomBarPadding
import com.streamo.app.ui.common.BrandButton
import com.streamo.app.ui.common.GlassCard
import com.streamo.app.ui.common.GlassDefaults
import com.streamo.app.ui.common.GlassLargeTitle
import com.streamo.app.ui.common.GlassTopBarScaffold
import kotlinx.coroutines.delay

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AdvancedSettingsScreen(
    scrollToWarp: Boolean = false,
    onBack: () -> Unit = {},
    viewModel: SettingsViewModel = hiltViewModel()
) {
    val snackbarHostState = remember { SnackbarHostState() }
    val message by viewModel.message.collectAsState()
    val tmdbKey by viewModel.tmdbApiKey.collectAsState()
    val providerLocale by viewModel.providerLocale.collectAsState()
    val warpEnabled by viewModel.warpEnabled.collectAsState()
    val warpRegistered by viewModel.warpRegistered.collectAsState()
    val warpBusy by viewModel.warpBusy.collectAsState()
    val warpStatus by viewModel.warpStatus.collectAsState()
    val confirmRecalc by viewModel.confirmRecalc.collectAsState()

    val scrollState = rememberScrollState()
    var warpCardOffset by remember { mutableStateOf(0f) }
    var highlightWarp by remember { mutableStateOf(false) }

    LaunchedEffect(scrollToWarp) {
        if (scrollToWarp) {
            highlightWarp = true
            scrollState.animateScrollTo(warpCardOffset.toInt())
            kotlinx.coroutines.delay(3000)
            highlightWarp = false
        }
    }

    val focusManager = LocalFocusManager.current

    var localTmdbKey by rememberSaveable { mutableStateOf("") }
    var isTmdbKeyFocused by remember { mutableStateOf(false) }
    LaunchedEffect(tmdbKey) {
        val loaded = tmdbKey
        if (loaded != null && !isTmdbKeyFocused) localTmdbKey = loaded
    }

    var localLocale by rememberSaveable { mutableStateOf("") }
    var isLocaleFocused by remember { mutableStateOf(false) }
    LaunchedEffect(providerLocale) {
        val loaded = providerLocale
        if (loaded != null && !isLocaleFocused) localLocale = loaded
    }

    LaunchedEffect(message) {
        message?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.clearMessage()
        }
    }

    if (confirmRecalc) {
        AlertDialog(
            onDismissRequest = { viewModel.dismissRecalcDialog() },
            title = { Text("Ricalcolare la libreria?") },
            text = { Text("Elimina i progressi dei titoli non più in cronologia né in lista. La cronologia e la lista non vengono toccate.") },
            confirmButton = {
                TextButton(onClick = { viewModel.recalculateLibrary() }) { Text("Ricalcola") }
            },
            dismissButton = {
                TextButton(onClick = { viewModel.dismissRecalcDialog() }) {
                    Text("Annulla", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        )
    }

    Scaffold(
        contentWindowInsets = androidx.compose.foundation.layout.WindowInsets(0, 0, 0, 0),
        snackbarHost = { SnackbarHost(snackbarHostState) }
    ) { _ ->
        GlassTopBarScaffold(
            onLeading = onBack
        ) { topPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(top = topPadding)
                .padding(16.dp)
                .verticalScroll(scrollState),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            GlassLargeTitle("Impostazioni avanzate")

            // ————————————————————————————
            // 1. Catalogo e provider
            // ————————————————————————————
            SectionHeaderAdv("Catalogo e provider")

            // Chiave TMDB
            GlassCard(modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text("Catalogo (TMDB)", style = MaterialTheme.typography.titleMedium)
                    Spacer(modifier = Modifier.height(8.dp))
                    OutlinedTextField(
                        value = localTmdbKey,
                        onValueChange = {
                            localTmdbKey = it
                            viewModel.setTmdbApiKey(it)
                        },
                        label = { Text("Chiave API TMDB") },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                        keyboardActions = KeyboardActions(onDone = { focusManager.clearFocus() }),
                        modifier = Modifier
                            .fillMaxWidth()
                            .onFocusChanged { state -> isTmdbKeyFocused = state.isFocused }
                    )
                    if (localTmdbKey.isBlank()) {
                        Text(
                            "Senza chiave il catalogo non si carica.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.error
                        )
                    }
                    Spacer(modifier = Modifier.height(4.dp))
                    val isDefaultKey = localTmdbKey == BuildConfig.DEFAULT_TMDB_API_KEY
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(14.dp))
                            .background(
                                if (isDefaultKey) Color.White.copy(alpha = 0.04f)
                                else Color.White.copy(alpha = 0.08f)
                            )
                            .then(
                                if (isDefaultKey) Modifier
                                else Modifier.border(1.dp, Color.White.copy(alpha = 0.12f), RoundedCornerShape(14.dp))
                            )
                            .clickable(enabled = !isDefaultKey) {
                                localTmdbKey = BuildConfig.DEFAULT_TMDB_API_KEY
                                viewModel.resetTmdbApiKey()
                            }
                            .padding(horizontal = 18.dp, vertical = 13.dp)
                    ) {
                        Text(
                            "Ripristina chiave predefinita",
                            style = MaterialTheme.typography.titleSmall,
                            color = if (isDefaultKey) MaterialTheme.colorScheme.onSurface.copy(alpha = 0.38f)
                            else MaterialTheme.colorScheme.error
                        )
                    }
                }
            }

            // Lingua provider
            GlassCard(modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text("Provider", style = MaterialTheme.typography.titleMedium)
                    Spacer(modifier = Modifier.height(8.dp))
                    OutlinedTextField(
                        value = localLocale,
                        onValueChange = {
                            localLocale = it
                            viewModel.setProviderLocale(it)
                        },
                        label = { Text("Lingua del provider (es. it)") },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                        keyboardActions = KeyboardActions(onDone = { focusManager.clearFocus() }),
                        modifier = Modifier
                            .fillMaxWidth()
                            .onFocusChanged { state -> isLocaleFocused = state.isFocused }
                    )
                    Text(
                        "Determina il mirror del provider di streaming. Lascia \"it\" se non sai cosa cambiare.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    val isDefaultLocale = localLocale == "it"
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(14.dp))
                            .background(
                                if (isDefaultLocale) Color.White.copy(alpha = 0.04f)
                                else Color.White.copy(alpha = 0.08f)
                            )
                            .then(
                                if (isDefaultLocale) Modifier
                                else Modifier.border(1.dp, Color.White.copy(alpha = 0.12f), RoundedCornerShape(14.dp))
                            )
                            .clickable(enabled = !isDefaultLocale) {
                                localLocale = "it"
                                viewModel.resetProviderLocale()
                            }
                            .padding(horizontal = 18.dp, vertical = 13.dp)
                    ) {
                        Text(
                            "Ripristina \"it\"",
                            style = MaterialTheme.typography.titleSmall,
                            color = if (isDefaultLocale) MaterialTheme.colorScheme.onSurface.copy(alpha = 0.38f)
                            else MaterialTheme.colorScheme.error
                        )
                    }
                }
            }

            // ————————————————————————————
            // 2. Rete e privacy
            // ————————————————————————————
            SectionHeaderAdv("Rete e privacy")

            // WARP
            GlassCard(
                modifier = Modifier
                    .fillMaxWidth()
                    .onGloballyPositioned { coords ->
                        warpCardOffset = coords.positionInRoot().y
                    }
                    .then(
                        if (highlightWarp) Modifier.border(
                            2.dp, MaterialTheme.colorScheme.primary, GlassDefaults.Shape
                        ) else Modifier
                    )
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text("Maschera IP (WARP)", style = MaterialTheme.typography.titleMedium)
                            Text(
                                "Instrada il traffico del provider e la riproduzione attraverso Cloudflare WARP, nascondendo il tuo IP. Non copre il cast su TV esterne.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                        Spacer(modifier = Modifier.size(12.dp))
                        Switch(
                            checked = warpEnabled,
                            onCheckedChange = { viewModel.setWarpEnabled(it) },
                            enabled = viewModel.warpAvailable && warpRegistered && !warpBusy
                        )
                    }

                    if (!viewModel.warpAvailable) {
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(
                            "Motore WARP non incluso in questa build. Genera warpkit.aar (android/wireproxykit/build.sh) e ricompila.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.error
                        )
                    } else {
                        Spacer(modifier = Modifier.height(8.dp))
                        BrandButton(
                            onClick = { viewModel.registerWarp() },
                            enabled = !warpBusy,
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text(if (warpRegistered) "Rigenera account WARP" else "Registra account WARP")
                        }
                        Spacer(modifier = Modifier.height(4.dp))
                        val egressEnabled = !warpBusy && warpRegistered && warpEnabled
                        Button(
                            onClick = { viewModel.verifyEgress() },
                            enabled = egressEnabled,
                            shape = RoundedCornerShape(14.dp),
                            colors = ButtonDefaults.buttonColors(
                                containerColor = Color.White.copy(alpha = 0.08f),
                                contentColor = Color.White,
                                disabledContainerColor = Color.White.copy(alpha = 0.04f),
                                disabledContentColor = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.38f)
                            ),
                            border = if (egressEnabled) BorderStroke(1.dp, Color.White.copy(alpha = 0.12f)) else null,
                            contentPadding = PaddingValues(horizontal = 18.dp, vertical = 13.dp),
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text("Verifica egress")
                        }
                        warpStatus?.let { status ->
                            Text(
                                status,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }
            }

            // ————————————————————————————
            // 3. Manutenzione
            // ————————————————————————————
            SectionHeaderAdv("Manutenzione")

            GlassCard(modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text("Ricalcola libreria", style = MaterialTheme.typography.titleMedium)
                    Spacer(modifier = Modifier.height(8.dp))
                    BrandButton(onClick = { viewModel.showRecalcDialog() }, modifier = Modifier.fillMaxWidth()) {
                        Text("Ricalcola libreria")
                    }
                    Text(
                        "Rimuove i progressi rimasti appesi dei titoli che hai tolto dalla cronologia e dalla lista, e aggiorna le statistiche e \"Continua a guardare\".",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }

            Spacer(modifier = Modifier.height(LocalBottomBarPadding.current))
        }
        }
    }
}

@Composable
private fun SectionHeaderAdv(title: String) {
    Text(
        text = title,
        style = MaterialTheme.typography.titleMedium,
        color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.padding(start = 4.dp, top = 8.dp)
    )
}