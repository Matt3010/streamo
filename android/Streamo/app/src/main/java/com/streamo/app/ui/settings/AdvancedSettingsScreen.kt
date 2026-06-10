package com.streamo.app.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
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
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.streamo.app.BuildConfig

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AdvancedSettingsScreen(
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
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = { Text("Impostazioni avanzate", style = MaterialTheme.typography.titleLarge) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Torna indietro")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background,
                    scrolledContainerColor = MaterialTheme.colorScheme.background,
                    titleContentColor = MaterialTheme.colorScheme.onBackground
                )
            )
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .padding(16.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // TMDB API Key
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
            ) {
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
                    TextButton(
                        onClick = {
                            localTmdbKey = BuildConfig.DEFAULT_TMDB_API_KEY
                            viewModel.resetTmdbApiKey()
                        },
                        enabled = localTmdbKey != BuildConfig.DEFAULT_TMDB_API_KEY
                    ) {
                        Text("Ripristina chiave predefinita")
                    }
                }
            }

            // Provider locale
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
            ) {
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
                    TextButton(
                        onClick = {
                            localLocale = "it"
                            viewModel.resetProviderLocale()
                        },
                        enabled = localLocale != "it"
                    ) {
                        Text("Ripristina \"it\"")
                    }
                }
            }

            // WARP (Cloudflare IP-masking)
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
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
                        Button(
                            onClick = { viewModel.registerWarp() },
                            enabled = !warpBusy,
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text(if (warpRegistered) "Rigenera account WARP" else "Registra account WARP")
                        }
                        TextButton(
                            onClick = { viewModel.verifyEgress() },
                            enabled = !warpBusy && warpRegistered,
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

            // Maintenance
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text("Manutenzione", style = MaterialTheme.typography.titleMedium)
                    Spacer(modifier = Modifier.height(8.dp))
                    Button(onClick = { viewModel.showRecalcDialog() }, modifier = Modifier.fillMaxWidth()) {
                        Text("Ricalcola libreria")
                    }
                    Text(
                        "Rimuove i progressi rimasti appesi dei titoli che hai tolto dalla cronologia e dalla lista, e aggiorna le statistiche e \"Continua a guardare\".",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        }
    }
}
