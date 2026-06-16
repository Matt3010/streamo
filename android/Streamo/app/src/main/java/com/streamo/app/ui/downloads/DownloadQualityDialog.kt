package com.streamo.app.ui.downloads

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.streamo.app.download.DownloadQualityPref
import com.streamo.app.ui.common.GlassAlertDialog
import com.streamo.app.ui.common.GlassDialogNeutralButton
import com.streamo.app.ui.common.GlassDialogPrimaryButton
import com.streamo.app.download.DownloadQualityRequest
import com.streamo.app.download.NetworkType
import dev.chrisbanes.haze.HazeState

/**
 * Modale di scelta qualità download (preferenza "Chiedi"). Elenca le risoluzioni rilevate
 * (o un set standard se non rilevate) più "Massima". Permette di salvare la scelta come
 * preferenza per la rete corrente. La qualità scelta è un tetto massimo, non garantito.
 */
@Composable
fun DownloadQualityDialog(
    request: DownloadQualityRequest,
    onConfirm: (pref: DownloadQualityPref, savePreference: Boolean) -> Unit,
    onDismiss: () -> Unit,
    hazeState: HazeState? = null
) {
    // Opzioni: risoluzioni reali (se rilevate) + "Massima"; fallback su set standard.
    val options: List<DownloadQualityPref> = remember(request.heights) {
        val caps = if (request.heights.isNotEmpty()) {
            request.heights.map { DownloadQualityPref.Cap(it) }
        } else {
            listOf(1080, 720, 480).map { DownloadQualityPref.Cap(it) }
        }
        listOf(DownloadQualityPref.Max) + caps
    }

    var selected by remember { mutableStateOf<DownloadQualityPref>(options.first()) }
    var savePref by remember { mutableStateOf(false) }

    val netLabel = when (request.networkType) {
        NetworkType.WIFI -> "Wi-Fi"
        NetworkType.MOBILE -> "rete mobile"
    }

    GlassAlertDialog(
        onDismissRequest = onDismiss,
        hazeState = hazeState,
        title = "Qualità download",
        text = {
            Column(modifier = Modifier.verticalScroll(rememberScrollState())) {
                Text(
                    text = "Scegli la qualità massima. È un tetto: se quella esatta non è " +
                        "disponibile verrà scaricata la più vicina inferiore.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                if (request.heights.isEmpty()) {
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = "Risoluzioni non rilevate: mostro le opzioni standard.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                if (request.appliesToAll) {
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = "La scelta verrà applicata a tutti gli episodi.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                Spacer(modifier = Modifier.height(8.dp))

                options.forEach { opt ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { selected = opt }
                            .padding(vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        RadioButton(
                            selected = selected == opt,
                            onClick = { selected = opt }
                        )
                        Spacer(modifier = Modifier.padding(start = 4.dp))
                        Text(opt.label())
                    }
                }

                Spacer(modifier = Modifier.height(8.dp))
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { savePref = !savePref }
                        .padding(vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Checkbox(checked = savePref, onCheckedChange = { savePref = it })
                    Spacer(modifier = Modifier.padding(start = 4.dp))
                    Text("Salva come preferenza per $netLabel")
                }
            }
        },
        confirmButton = {
            GlassDialogPrimaryButton(onClick = { onConfirm(selected, savePref) }) {
                Text("Scarica")
            }
        },
        dismissButton = {
            GlassDialogNeutralButton(onClick = onDismiss) {
                Text("Annulla")
            }
        }
    )
}
