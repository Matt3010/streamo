package com.streamo.app.ui.settings

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.streamo.app.download.DownloadQualityPref
import com.streamo.app.download.NetworkType

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    onNavigateToAdvanced: () -> Unit = {},
    viewModel: SettingsViewModel = hiltViewModel()
) {
    val snackbarHostState = remember { SnackbarHostState() }
    val message by viewModel.message.collectAsState()
    val stats by viewModel.stats.collectAsState()
    val autoplay by viewModel.autoplayNext.collectAsState()
    val autoDelete by viewModel.autoDeleteWatched.collectAsState()
    val folders by viewModel.foldersEnabled.collectAsState()
    val showCardInfo by viewModel.showCardInfo.collectAsState()
    val accent by viewModel.accentColor.collectAsState()
    val dlQualityWifi by viewModel.downloadQualityWifi.collectAsState()
    val dlQualityMobile by viewModel.downloadQualityMobile.collectAsState()
    val streamingQuality by viewModel.streamingQuality.collectAsState()
    // Rete di cui si sta scegliendo la qualità (null = nessun picker aperto).
    var qualityPickerFor by remember { mutableStateOf<NetworkType?>(null) }
    var showStreamingQualityPicker by remember { mutableStateOf(false) }
    val confirmRestore1 by viewModel.confirmRestoreStep1.collectAsState()
    val confirmRestore2 by viewModel.confirmRestoreStep2.collectAsState()

    val exportLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.CreateDocument("application/json")
    ) { uri ->
        uri?.let { viewModel.export(it) }
    }

    val importLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri ->
        uri?.let { viewModel.requestRestore(it) }
    }

    LaunchedEffect(message) {
        message?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.clearMessage()
        }
    }

    qualityPickerFor?.let { net ->
        val current = if (net == NetworkType.WIFI) dlQualityWifi else dlQualityMobile
        val netLabel = if (net == NetworkType.WIFI) "Wi-Fi" else "rete mobile"
        AlertDialog(
            onDismissRequest = { qualityPickerFor = null },
            title = { Text("Qualità download · $netLabel") },
            text = {
                Column {
                    DownloadQualityPref.SETTINGS_OPTIONS.forEach { opt ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    if (net == NetworkType.WIFI) viewModel.setDownloadQualityWifi(opt)
                                    else viewModel.setDownloadQualityMobile(opt)
                                    qualityPickerFor = null
                                }
                                .padding(vertical = 4.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            RadioButton(
                                selected = current.serialize() == opt.serialize(),
                                onClick = {
                                    if (net == NetworkType.WIFI) viewModel.setDownloadQualityWifi(opt)
                                    else viewModel.setDownloadQualityMobile(opt)
                                    qualityPickerFor = null
                                }
                            )
                            Spacer(modifier = Modifier.size(4.dp))
                            Text(opt.label())
                        }
                    }
                }
            },
            confirmButton = {},
            dismissButton = {
                TextButton(onClick = { qualityPickerFor = null }) {
                    Text("Annulla", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        )
    }

    if (showStreamingQualityPicker) {
        val options = listOf("auto" to "Auto", "1080" to "1080p", "720" to "720p", "480" to "480p")
        AlertDialog(
            onDismissRequest = { showStreamingQualityPicker = false },
            title = { Text("Qualità streaming") },
            text = {
                Column {
                    options.forEach { (token, label) ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    viewModel.setStreamingQuality(token)
                                    showStreamingQualityPicker = false
                                }
                                .padding(vertical = 4.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            RadioButton(
                                selected = streamingQuality == token,
                                onClick = {
                                    viewModel.setStreamingQuality(token)
                                    showStreamingQualityPicker = false
                                }
                            )
                            Spacer(modifier = Modifier.size(4.dp))
                            Text(label)
                        }
                    }
                }
            },
            confirmButton = {},
            dismissButton = {
                TextButton(onClick = { showStreamingQualityPicker = false }) {
                    Text("Annulla", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        )
    }

    if (confirmRestore1) {
        AlertDialog(
            onDismissRequest = { viewModel.cancelRestore() },
            title = { Text("Ripristinare dal backup?") },
            text = { Text("Tutti i dati attuali (lista, cronologia, progressi, download) verranno sostituiti con quelli del backup. L'operazione non è reversibile.") },
            confirmButton = {
                TextButton(onClick = { viewModel.proceedToRestoreStep2() }) { Text("Continua") }
            },
            dismissButton = {
                TextButton(onClick = { viewModel.cancelRestore() }) { Text("Annulla", color = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
        )
    }

    if (confirmRestore2) {
        AlertDialog(
            onDismissRequest = { viewModel.cancelRestore() },
            title = { Text("Confermi il ripristino?") },
            text = { Text("Sei sicuro? I dati attuali andranno persi definitivamente.") },
            confirmButton = {
                TextButton(onClick = { viewModel.confirmRestore() }) { Text("Ripristina") }
            },
            dismissButton = {
                TextButton(onClick = { viewModel.cancelRestore() }) { Text("Annulla", color = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
        )
    }

    Scaffold(
        contentWindowInsets = androidx.compose.foundation.layout.WindowInsets(0, 0, 0, 0),
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        "Impostazioni",
                        style = MaterialTheme.typography.titleLarge
                    )
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
            // Aspetto: colore + info card
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text("Colore dell'app", style = MaterialTheme.typography.titleMedium)
                    Spacer(modifier = Modifier.height(8.dp))
                    val presets = listOf(
                        Color(0xFFE50914), // brand red
                        Color(0xFF2196F3),
                        Color(0xFF4CAF50),
                        Color(0xFFFF9800),
                        Color(0xFF9C27B0),
                        Color(0xFF00BCD4),
                        Color(0xFFFFEB3B),
                        Color(0xFFE91E63)
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        presets.forEach { color ->
                            val current = Color(accent.first, accent.second, accent.third)
                            val selected = color == current
                            Box(
                                modifier = Modifier
                                    .size(36.dp)
                                    .clip(CircleShape)
                                    .background(color)
                                    .clickable { viewModel.setAccentColor(color.red, color.green, color.blue) },
                                contentAlignment = Alignment.Center
                            ) {
                                if (selected) {
                                    Box(modifier = Modifier.fillMaxSize().background(Color.White.copy(alpha = 0.3f), CircleShape))
                                }
                            }
                        }
                    }
                    Spacer(modifier = Modifier.height(8.dp))
                    TextButton(onClick = { viewModel.resetAccentColor() }) {
                        Text("Ripristina rosso predefinito")
                    }
                    Spacer(modifier = Modifier.height(8.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text("Mostra titolo, anno e voto", style = MaterialTheme.typography.bodyLarge)
                            Text(
                                "Mostra le informazioni sotto le copertine. \"Continua a guardare\" le mostra comunque.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                        Spacer(modifier = Modifier.size(12.dp))
                        Switch(
                            checked = showCardInfo,
                            onCheckedChange = { viewModel.setShowCardInfo(it) }
                        )
                    }
                }
            }

            // Playback
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
                        Text("Riproduci episodio successivo", style = MaterialTheme.typography.bodyLarge)
                        Switch(
                            checked = autoplay,
                            onCheckedChange = { viewModel.setAutoplayNext(it) }
                        )
                    }
                    QualityPickerRow(
                        label = "Qualità streaming",
                        value = streamingQualityLabel(streamingQuality),
                        onClick = { showStreamingQualityPicker = true }
                    )
                }
            }

            // Downloads
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text("Elimina dopo la visione", style = MaterialTheme.typography.bodyLarge)
                        Text(
                            "Cancella automaticamente un download quando lo hai finito di guardare (≥90%).",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    Switch(
                        checked = autoDelete,
                        onCheckedChange = { viewModel.setAutoDeleteWatched(it) }
                    )
                }
            }

            // Download quality per network
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text("Qualità download", style = MaterialTheme.typography.titleMedium)
                    Text(
                        "Risoluzione massima per il download in base alla rete. \"Chiedi\" mostra una scelta a ogni download.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    QualityPickerRow(
                        label = "Wi-Fi",
                        value = dlQualityWifi.label(),
                        onClick = { qualityPickerFor = NetworkType.WIFI }
                    )
                    QualityPickerRow(
                        label = "Rete mobile",
                        value = dlQualityMobile.label(),
                        onClick = { qualityPickerFor = NetworkType.MOBILE }
                    )
                }
            }

            // Organization
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text("Folder nella mia lista", style = MaterialTheme.typography.bodyLarge)
                        Text(
                            "Raggruppa film e serie in cartelle nella tua lista.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    Switch(
                        checked = folders,
                        onCheckedChange = { viewModel.setFoldersEnabled(it) }
                    )
                }
            }

            // Statistics
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text("Statistiche", style = MaterialTheme.typography.titleMedium)
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(stats, style = MaterialTheme.typography.bodyLarge)
                }
            }

            // Backup
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
            ) {
                Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Backup", style = MaterialTheme.typography.titleMedium)
                    Button(
                        onClick = { exportLauncher.launch("project-obsidian-backup.json") },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text("Esporta backup JSON")
                    }
                    Button(
                        onClick = { importLauncher.launch(arrayOf("application/json", "text/plain")) },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text("Importa backup JSON")
                    }
                    Text(
                        "Il backup esporta lista, cronologia, progressi, segnalibri e impostazioni in un file .json che puoi salvare dove vuoi. Il ripristino sostituisce TUTTI i dati attuali. I file dei download non sono inclusi: andranno riscaricati.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }

            // Advanced settings link
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable(onClick = onNavigateToAdvanced),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text("Impostazioni avanzate", style = MaterialTheme.typography.bodyLarge)
                        Text(
                            "Chiave TMDB, provider, maschera IP (WARP), manutenzione.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    Icon(
                        imageVector = Icons.AutoMirrored.Filled.KeyboardArrowRight,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }

            // App info
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("Versione", style = MaterialTheme.typography.bodyLarge)
                        Text(viewModel.appVersion, style = MaterialTheme.typography.bodyLarge)
                    }
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        "Project Obsidian — app personale. Lo streaming usa provider di terze parti; la legalità dipende dalle tue leggi locali.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        }
    }
}

private fun streamingQualityLabel(token: String): String = when (token) {
    "1080" -> "1080p"
    "720" -> "720p"
    "480" -> "480p"
    else -> "Auto"
}

/** Riga impostazione qualità: etichetta a sinistra, valore corrente (cliccabile) a destra. */
@Composable
private fun QualityPickerRow(
    label: String,
    value: String,
    onClick: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(label, style = MaterialTheme.typography.bodyLarge)
        Text(
            text = value,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.primary
        )
    }
}
