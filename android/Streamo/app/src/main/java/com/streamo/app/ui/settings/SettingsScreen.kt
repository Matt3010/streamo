package com.streamo.app.ui.settings

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.layout.ContentScale
import com.streamo.app.R
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.material3.OutlinedTextField
import androidx.hilt.navigation.compose.hiltViewModel
import com.streamo.app.data.preferences.SettingsDataStore
import com.streamo.app.download.DownloadQualityPref
import com.streamo.app.download.NetworkType
import com.streamo.app.navigation.LocalBottomBarPadding
import com.streamo.app.ui.common.BrandButton
import com.streamo.app.ui.common.GlassAlertDialog
import com.streamo.app.ui.common.GlassCard
import com.streamo.app.ui.common.GlassDialogDestructiveButton
import com.streamo.app.ui.common.GlassDialogNeutralButton
import com.streamo.app.ui.common.GlassDialogPrimaryButton
import com.streamo.app.ui.common.GlassLargeTitle
import com.streamo.app.ui.common.GlassTopBarScaffold

private fun hsvColor(h: Float, s: Float, v: Float): Color =
    Color(android.graphics.Color.HSVToColor(floatArrayOf(h, s, v)))

private fun rgbToHsv(r: Float, g: Float, b: Float): Triple<Float, Float, Float> {
    val mx = maxOf(r, g, b); val mn = minOf(r, g, b); val d = mx - mn
    val v = mx; val s = if (mx == 0f) 0f else d / mx
    val h = when {
        d == 0f -> 0f; mx == r -> (((g - b) / d) % 6f) * 60f
        mx == g -> ((b - r) / d + 2f) * 60f; else -> ((r - g) / d + 4f) * 60f
    }
    return Triple(if (h < 0) h + 360f else h, s, v)
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun SettingsScreen(
    onNavigateToAdvanced: () -> Unit = {},
    onBack: () -> Unit = {},
    viewModel: SettingsViewModel = hiltViewModel()
) {
    val snackbarHostState = remember { SnackbarHostState() }
    val message by viewModel.message.collectAsState()
    val stats by viewModel.stats.collectAsState()
    val autoplay by viewModel.autoplayNext.collectAsState()
    val autoDelete by viewModel.autoDeleteWatched.collectAsState()
    val showCardInfo by viewModel.showCardInfo.collectAsState()
    val reduceEffects by viewModel.reduceEffects.collectAsState()
    val accent by viewModel.accentColor.collectAsState()
    val dlQualityWifi by viewModel.downloadQualityWifi.collectAsState()
    val dlQualityMobile by viewModel.downloadQualityMobile.collectAsState()
    val streamingQualityWifi by viewModel.streamingQualityWifi.collectAsState()
    val streamingQualityMobile by viewModel.streamingQualityMobile.collectAsState()
    var qualityPickerFor by remember { mutableStateOf<NetworkType?>(null) }
    var streamingPickerFor by remember { mutableStateOf<NetworkType?>(null) }
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
        GlassAlertDialog(
            onDismissRequest = { qualityPickerFor = null },
            title = "Qualità download · $netLabel",
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
                GlassDialogNeutralButton(onClick = { qualityPickerFor = null }) { Text("Annulla") }
            }
        )
    }

    streamingPickerFor?.let { net ->
        val current = if (net == NetworkType.WIFI) streamingQualityWifi else streamingQualityMobile
        val netLabel = if (net == NetworkType.WIFI) "Wi-Fi" else "rete mobile"
        val options = listOf("auto" to "Auto", "max" to "Massima", "1080" to "1080p", "720" to "720p", "480" to "480p")
        GlassAlertDialog(
            onDismissRequest = { streamingPickerFor = null },
            title = "Qualità streaming · $netLabel",
            text = {
                Column {
                    options.forEach { (token, label) ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    if (net == NetworkType.WIFI) viewModel.setStreamingQualityWifi(token)
                                    else viewModel.setStreamingQualityMobile(token)
                                    streamingPickerFor = null
                                }
                                .padding(vertical = 4.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            RadioButton(
                                selected = current == token,
                                onClick = {
                                    if (net == NetworkType.WIFI) viewModel.setStreamingQualityWifi(token)
                                    else viewModel.setStreamingQualityMobile(token)
                                    streamingPickerFor = null
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
                GlassDialogNeutralButton(onClick = { streamingPickerFor = null }) { Text("Annulla") }
            }
        )
    }

    if (confirmRestore1) {
        GlassAlertDialog(
            onDismissRequest = { viewModel.cancelRestore() },
            title = "Ripristinare dal backup?",
            text = { Text("Tutti i dati attuali (lista, cronologia, progressi, download) verranno sostituiti con quelli del backup. L'operazione non è reversibile.") },
            confirmButton = {
                GlassDialogPrimaryButton(onClick = { viewModel.proceedToRestoreStep2() }) { Text("Continua") }
            },
            dismissButton = {
                GlassDialogNeutralButton(onClick = { viewModel.cancelRestore() }) { Text("Annulla") }
            }
        )
    }

    if (confirmRestore2) {
        GlassAlertDialog(
            onDismissRequest = { viewModel.cancelRestore() },
            title = "Confermi il ripristino?",
            text = { Text("Sei sicuro? I dati attuali andranno persi definitivamente.") },
            confirmButton = {
                GlassDialogDestructiveButton(onClick = { viewModel.confirmRestore() }) { Text("Ripristina") }
            },
            dismissButton = {
                GlassDialogNeutralButton(onClick = { viewModel.cancelRestore() }) { Text("Annulla") }
            }
        )
    }

    GlassTopBarScaffold(
        onLeading = onBack
    ) { topPadding ->
        Box(modifier = Modifier.fillMaxSize()) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Spacer(modifier = Modifier.height(topPadding))
            GlassLargeTitle("Impostazioni")

            // ————————————————————————————
            // 1. Aspetto
            // ————————————————————————————
            SectionHeader("Aspetto")

            // Accent color
            GlassCard(modifier = Modifier.fillMaxWidth()) {
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
                    val currentColor = Color(accent.first, accent.second, accent.third)
                    var showPicker by remember { mutableStateOf(false) }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            modifier = Modifier
                                .size(40.dp)
                                .clip(CircleShape)
                                .background(currentColor)
                                .clickable { showPicker = true },
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(
                                Icons.Filled.Edit,
                                contentDescription = "Scegli colore",
                                tint = Color.White,
                                modifier = Modifier.size(18.dp)
                            )
                        }
                        Spacer(modifier = Modifier.width(12.dp))
                        FlowRow(
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            presets.forEach { color ->
                                val selected = color == currentColor
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
                    }
                    val isDefaultAccent = accent == SettingsDataStore.defaultAccent
                    Spacer(modifier = Modifier.height(8.dp))
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(14.dp))
                            .background(
                                if (isDefaultAccent) Color.White.copy(alpha = 0.04f)
                                else Color.White.copy(alpha = 0.08f)
                            )
                            .then(
                                if (isDefaultAccent) Modifier
                                else Modifier.border(1.dp, Color.White.copy(alpha = 0.12f), RoundedCornerShape(14.dp))
                            )
                            .clickable(enabled = !isDefaultAccent) { viewModel.resetAccentColor() }
                            .padding(horizontal = 18.dp, vertical = 13.dp)
                    ) {
                        Text(
                            "Ripristina rosso predefinito",
                            style = MaterialTheme.typography.titleSmall,
                            color = if (isDefaultAccent) MaterialTheme.colorScheme.onSurface.copy(alpha = 0.38f)
                            else MaterialTheme.colorScheme.error
                        )
                    }

                    // Color picker dialog — palette saturazione/luminosità + hue + RGB
                    if (showPicker) {
                        var hue by remember { mutableFloatStateOf(0f) }
                        var sat by remember { mutableFloatStateOf(1f) }
                        var value by remember { mutableFloatStateOf(1f) }
                        LaunchedEffect(Unit) {
                            val (h, s, v) = rgbToHsv(currentColor.red, currentColor.green, currentColor.blue)
                            hue = h; sat = s; value = v
                        }
                        val pickerColor = remember(hue, sat, value) { hsvColor(hue, sat, value) }
                        var rText by remember { mutableStateOf("") }
                        var gText by remember { mutableStateOf("") }
                        var bText by remember { mutableStateOf("") }
                        LaunchedEffect(Unit) {
                            rText = (currentColor.red * 255).toInt().toString()
                            gText = (currentColor.green * 255).toInt().toString()
                            bText = (currentColor.blue * 255).toInt().toString()
                        }
                        LaunchedEffect(pickerColor) {
                            rText = (pickerColor.red * 255).toInt().toString()
                            gText = (pickerColor.green * 255).toInt().toString()
                            bText = (pickerColor.blue * 255).toInt().toString()
                        }
                        GlassAlertDialog(
                            onDismissRequest = { showPicker = false },
                            title = "Scegli colore",
                            text = {
                                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                    Box(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .height(180.dp)
                                            .clip(RoundedCornerShape(10.dp))
                                            .background(Brush.verticalGradient(listOf(Color.White, Color.Black)))
                                            .background(Brush.horizontalGradient(listOf(Color.White, hsvColor(hue, 1f, 1f))))
                                            .pointerInput(Unit) {
                                            detectDragGestures { change, _ ->
                                                change.consume()
                                                sat = (change.position.x / size.width).coerceIn(0f, 1f)
                                                value = 1f - (change.position.y / size.height).coerceIn(0f, 1f)
                                            }
                                        }
                                    ) {
                                        Canvas(modifier = Modifier.fillMaxSize()) {
                                            val cx = sat * size.width; val cy = (1f - value) * size.height
                                            drawCircle(Color.White, radius = 6f, center = Offset(cx, cy))
                                            drawCircle(Color.Black.copy(alpha = 0.5f), radius = 6f, center = Offset(cx, cy), style = Stroke(width = 2f))
                                        }
                                    }
                                    Box(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .height(28.dp)
                                            .clip(RoundedCornerShape(8.dp))
                                            .background(Brush.horizontalGradient(listOf(
                                                Color.Red, Color.Yellow, Color.Green, Color.Cyan, Color.Blue, Color.Magenta, Color.Red
                                            )))
                                            .pointerInput(Unit) {
                                            detectDragGestures { change, _ ->
                                                change.consume()
                                                hue = (change.position.x / size.width * 360f).coerceIn(0f, 360f)
                                            }
                                        }
                                    ) {
                                        Canvas(modifier = Modifier.fillMaxSize()) {
                                            val tx = hue / 360f * size.width
                                            drawCircle(Color.White, radius = 8f, center = Offset(tx, size.height / 2f))
                                            drawCircle(Color.Black.copy(alpha = 0.4f), radius = 8f, center = Offset(tx, size.height / 2f), style = Stroke(2f))
                                        }
                                    }

                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Box(
                                            modifier = Modifier.size(40.dp).clip(RoundedCornerShape(8.dp)).background(pickerColor)
                                        )
                                        Spacer(Modifier.width(12.dp))
                                        val fields = listOf("R" to rText, "G" to gText, "B" to bText)
                                        fields.forEachIndexed { i, (label, text) ->
                                            OutlinedTextField(
                                                value = text,
                                                onValueChange = { newVal ->
                                                    val filtered = newVal.filter { it.isDigit() }.take(3)
                                                    val r = if (i == 0) filtered else rText
                                                    val g = if (i == 1) filtered else gText
                                                    val b = if (i == 2) filtered else bText
                                                    rText = r; gText = g; bText = b
                                                    val ri = r.toIntOrNull()?.coerceIn(0, 255)
                                                    val gi = g.toIntOrNull()?.coerceIn(0, 255)
                                                    val bi = b.toIntOrNull()?.coerceIn(0, 255)
                                                    if (ri != null && gi != null && bi != null) {
                                                        val (h, s, v) = rgbToHsv(ri / 255f, gi / 255f, bi / 255f)
                                                        hue = h; sat = s; value = v
                                                    }
                                                },
                                                modifier = Modifier.width(56.dp),
                                                label = { Text(label, style = MaterialTheme.typography.labelSmall) },
                                                singleLine = true,
                                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                                                textStyle = MaterialTheme.typography.bodyMedium
                                            )
                                            if (i < 2) Spacer(Modifier.width(6.dp))
                                        }
                                    }
                                }
                            },
                            confirmButton = {
                                GlassDialogPrimaryButton(onClick = {
                                    viewModel.setAccentColor(pickerColor.red, pickerColor.green, pickerColor.blue)
                                    showPicker = false
                                }) { Text("Applica") }
                            },
                            dismissButton = {
                                GlassDialogNeutralButton(onClick = { showPicker = false }) { Text("Annulla") }
                            }
                        )
                    }
                }
            }

            // Mostra info card
            GlassCard(modifier = Modifier.fillMaxWidth()) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp),
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

            // Prestazioni — disabilita blur/animazioni della UI glass
            GlassCard(modifier = Modifier.fillMaxWidth()) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text("Modalità prestazioni", style = MaterialTheme.typography.bodyLarge)
                        Text(
                            "Disattiva sfocature e animazioni della UI, usando sfondi semitrasparenti. Migliora la fluidità sui dispositivi meno potenti.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    Spacer(modifier = Modifier.size(12.dp))
                    Switch(
                        checked = reduceEffects,
                        onCheckedChange = { viewModel.setReduceEffects(it) }
                    )
                }
            }

            // ————————————————————————————
            // 2. Riproduzione
            // ————————————————————————————
            SectionHeader("Riproduzione")

            GlassCard(modifier = Modifier.fillMaxWidth()) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text("Riproduci episodio successivo", style = MaterialTheme.typography.bodyLarge)
                    Switch(
                        checked = autoplay,
                        onCheckedChange = { viewModel.setAutoplayNext(it) }
                    )
                }
            }

            GlassCard(modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text("Qualità streaming", style = MaterialTheme.typography.titleMedium)
                    Text(
                        "Risoluzione massima per lo streaming in base alla rete.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    QualityPickerRow(
                        label = "Wi-Fi",
                        value = streamingQualityLabel(streamingQualityWifi),
                        onClick = { streamingPickerFor = NetworkType.WIFI }
                    )
                    QualityPickerRow(
                        label = "Rete mobile",
                        value = streamingQualityLabel(streamingQualityMobile),
                        onClick = { streamingPickerFor = NetworkType.MOBILE }
                    )
                }
            }

            // ————————————————————————————
            // 3. Download
            // ————————————————————————————
            SectionHeader("Download")

            GlassCard(modifier = Modifier.fillMaxWidth()) {
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

            GlassCard(modifier = Modifier.fillMaxWidth()) {
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

            // ————————————————————————————
            // 4. Dati
            // ————————————————————————————
            SectionHeader("Dati")

            GlassCard(modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text("Statistiche", style = MaterialTheme.typography.titleMedium)
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(stats, style = MaterialTheme.typography.bodyLarge)
                }
            }

            GlassCard(modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Backup", style = MaterialTheme.typography.titleMedium)
                    BrandButton(
                        onClick = { exportLauncher.launch("project-obsidian-backup.json") },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text("Esporta backup JSON")
                    }
                    BrandButton(
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

            // ————————————————————————————
            // 5. Impostazioni avanzate (link)
            // ————————————————————————————
            SectionHeader("Avanzate")

            GlassCard(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable(onClick = onNavigateToAdvanced)
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

            // ————————————————————————————
            // 6. Informazioni
            // ————————————————————————————
            SectionHeader("Informazioni")

            GlassCard(modifier = Modifier.fillMaxWidth()) {
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

            GlassCard(modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Image(
                        painter = painterResource(id = com.streamo.app.R.drawable.tmdb_logo),
                        contentDescription = "TMDB",
                        contentScale = ContentScale.Fit,
                        modifier = Modifier.fillMaxWidth().height(24.dp)
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        "Questa applicazione utilizza TMDB e le API di TMDB ma non è approvata, certificata o in alcun modo autorizzata da TMDB.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }

            Spacer(modifier = Modifier.height(LocalBottomBarPadding.current))
        }
        SnackbarHost(
            hostState = snackbarHostState,
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(bottom = LocalBottomBarPadding.current)
        )
        }
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

@Composable
private fun SectionHeader(title: String) {
    Text(
        text = title,
        style = MaterialTheme.typography.titleMedium,
        color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.padding(start = 4.dp, top = 8.dp)
    )
}