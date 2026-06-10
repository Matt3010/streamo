package com.streamo.app.ui.player.cast

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Cast
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Tv
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.streamo.app.player.dlna.DlnaRenderer
import com.streamo.app.player.lancast.LanRenderer

/**
 * Dialog di selezione dispositivo cast. Raggruppa i dispositivi per IP:
 * se un dispositivo espone sia Obsidian (NSD) che DLNA (SSDP), mostra un
 * pannello-dettaglio orizzontale con scelta del protocollo + checkbox
 * "Ricorda la scelta".
 *
 * @param groups        dispositivi raggruppati per IP
 * @param dlnaScanning  true se la scansione DLNA è in corso
 * @param lanScanning true se la scansione Obsidian è in corso
 * @param connectedName nome del dispositivo connesso (null se nessuno)
 * @param connectedProtocol protocollo del dispositivo connesso ("streamo"/"dlna")
 * @param preferredProtocol protocollo preferito per ogni device key (null = chiedi sempre)
 * @param onCastToDlna  callback cast DLNA
 * @param onCastToLan callback cast Obsidian
 * @param onStopCast    callback interrompi cast
 * @param onRefresh     callback riscansione
 * @param onRemember    callback ricorda preferenza (key, protocol)
 * @param onDismiss     callback chiusura dialog
 */
@Composable
fun CastPickerDialog(
    groups: List<CastDeviceGroup>,
    dlnaScanning: Boolean,
    lanScanning: Boolean,
    connectedName: String?,
    connectedProtocol: String?,
    preferredProtocol: (String) -> String?,
    onCastToDlna: (DlnaRenderer) -> Unit,
    onCastToLan: (LanRenderer) -> Unit,
    onStopCast: () -> Unit,
    onRefresh: () -> Unit,
    onRemember: (String, String) -> Unit,
    onDismiss: () -> Unit
) {
    val scanning = dlnaScanning || lanScanning

    // Stato pannello-dettaglio: null = lista master, non-null = dettaglio del device.
    var detailGroup by remember { mutableStateOf<CastDeviceGroup?>(null) }

    // All'ingresso nello stato connesso: collassa il pannello-dettaglio.
    LaunchedEffect(connectedName) {
        if (connectedName != null) detailGroup = null
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Color(0xFF1E1E20),
        title = { Text("Trasmetti su TV", color = Color.White) },
        text = {
            Column {
                if (connectedName != null) {
                    // Già connesso
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            imageVector = Icons.Filled.Check,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.size(20.dp)
                        )
                        Spacer(modifier = Modifier.width(12.dp))
                        val protoLabel = if (connectedProtocol == "streamo") "Obsidian" else "DLNA"
                        Text(
                            "In riproduzione su $connectedName ($protoLabel)",
                            color = Color.White
                        )
                    }
                } else if (scanning) {
                    // Scansione in corso
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(20.dp),
                            strokeWidth = 2.dp,
                            color = MaterialTheme.colorScheme.primary
                        )
                        Spacer(modifier = Modifier.width(12.dp))
                        Text("Ricerca dispositivi…", color = Color.White)
                    }
                } else if (groups.isEmpty()) {
                    // Nessun dispositivo
                    Text(
                        "Nessun dispositivo trovato. Verifica che la TV sia accesa e sulla stessa rete Wi-Fi.",
                        color = Color.White.copy(alpha = 0.7f)
                    )
                } else {
                    // Master-detail: lista device (A) <-> scelta metodo (B).
                    AnimatedContent(
                        targetState = detailGroup,
                        transitionSpec = {
                            // Direzione: in base a se stiamo andando verso il dettaglio o tornando indietro.
                            val forward = targetState != null
                            val slideIn = if (forward) {
                                slideInHorizontally(animationSpec = tween(220)) { fullWidth -> fullWidth } +
                                    fadeIn(animationSpec = tween(220))
                            } else {
                                slideInHorizontally(animationSpec = tween(220)) { fullWidth -> -fullWidth } +
                                    fadeIn(animationSpec = tween(220))
                            }
                            val slideOut = if (forward) {
                                slideOutHorizontally(animationSpec = tween(220)) { fullWidth -> -fullWidth } +
                                    fadeOut(animationSpec = tween(220))
                            } else {
                                slideOutHorizontally(animationSpec = tween(220)) { fullWidth -> fullWidth } +
                                    fadeOut(animationSpec = tween(220))
                            }
                            slideIn togetherWith slideOut
                        },
                        label = "CastPickerMasterDetail"
                    ) { currentDetail ->
                        if (currentDetail == null) {
                            // Pannello A: lista device
                            Column {
                                groups.forEach { group ->
                                    CastDeviceRow(
                                        group = group,
                                        preferredProtocol = preferredProtocol,
                                        onCastToDlna = { onCastToDlna(it) },
                                        onCastToLan = { onCastToLan(it) },
                                        onShowDetail = { detailGroup = it }
                                    )
                                    Spacer(modifier = Modifier.height(4.dp))
                                }
                            }
                        } else {
                            // Pannello B: scelta metodo per il device selezionato
                            CastDetailPanel(
                                group = currentDetail,
                                preferredProtocol = preferredProtocol,
                                onBack = { detailGroup = null },
                                onCastToDlna = { onCastToDlna(it) },
                                onCastToLan = { onCastToLan(it) },
                                onRemember = onRemember
                            )
                        }
                    }
                }
            }
        },
        confirmButton = {
            if (connectedName != null) {
                TextButton(onClick = onStopCast) {
                    Text("Interrompi", color = MaterialTheme.colorScheme.error)
                }
            } else {
                TextButton(onClick = onRefresh, enabled = !scanning) {
                    Text("Aggiorna")
                }
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Chiudi", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    )
}

/**
 * Riga per un singolo dispositivo nella lista master. Delega la decisione
 * al callback onShowDetail quando servono entrambi i metodi e non c'è preferenza.
 *
 * - una sola modalità disponibile → connette subito, modalità tra parentesi
 *   (es. "Soggiorno (Obsidian)");
 * - entrambe le modalità + preferenza salvata valida → connette subito col protocollo
 *   ricordato, "Cambia metodo" riapre il pannello-dettaglio via onShowDetail;
 * - entrambe le modalità senza preferenza → tap apre il pannello-dettaglio via onShowDetail.
 */
@Composable
private fun CastDeviceRow(
    group: CastDeviceGroup,
    preferredProtocol: (String) -> String?,
    onCastToDlna: (DlnaRenderer) -> Unit,
    onCastToLan: (LanRenderer) -> Unit,
    onShowDetail: (CastDeviceGroup) -> Unit
) {
    val savedPref = preferredProtocol(group.key)
    // Preferenza valida solo se il protocollo ricordato è ancora disponibile sul device.
    val effectivePref = savedPref?.takeIf {
        (it == "streamo" && group.lanRenderer != null) ||
            (it == "dlna" && group.dlnaRenderer != null)
    }

    fun protoLabel(p: String) = if (p == "streamo") "Obsidian" else "DLNA"

    fun connect(protocol: String) {
        when (protocol) {
            "streamo" -> group.lanRenderer?.let { onCastToLan(it) }
            "dlna" -> group.dlnaRenderer?.let { onCastToDlna(it) }
        }
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 6.dp)
    ) {
        // Una sola modalità: voce unica, connette diretto, modalità tra parentesi.
        if (!group.hasBoth) {
            val proto = if (group.lanRenderer != null) "streamo" else "dlna"
            ProtocolConnectRow(
                label = "${group.name} (${protoLabel(proto)})",
                badge = if (proto == "streamo") "Raccomandato" else null,
                preferred = false,
                onClick = { connect(proto) }
            )
            return@Column
        }

        // Entrambe le modalità, con preferenza salvata valida: connette diretto.
        if (effectivePref != null) {
            ProtocolConnectRow(
                label = "${group.name} (${protoLabel(effectivePref)})",
                badge = null,
                preferred = true,
                onClick = { connect(effectivePref) }
            )
            TextButton(
                onClick = { onShowDetail(group) },
                modifier = Modifier.padding(start = 20.dp)
            ) {
                Text(
                    "Cambia metodo",
                    color = Color.White.copy(alpha = 0.7f),
                    fontSize = 13.sp
                )
            }
        } else {
            // Nessuna preferenza: il tap sul device apre il pannello-dettaglio.
            DeviceHeaderRow(name = group.name) { onShowDetail(group) }
        }
    }
}

/**
 * Pannello-dettaglio: header con back + nome device, due ProtocolConnectRow
 * (Obsidian raccomandato + DLNA) e checkbox "Ricorda la scelta".
 */
@Composable
private fun CastDetailPanel(
    group: CastDeviceGroup,
    preferredProtocol: (String) -> String?,
    onBack: () -> Unit,
    onCastToDlna: (DlnaRenderer) -> Unit,
    onCastToLan: (LanRenderer) -> Unit,
    onRemember: (String, String) -> Unit
) {
    val savedPref = preferredProtocol(group.key)
    var rememberChoice by remember(savedPref) { mutableStateOf(savedPref != null) }

    fun connect(protocol: String) {
        if (rememberChoice) onRemember(group.key, protocol)
        when (protocol) {
            "streamo" -> group.lanRenderer?.let { onCastToLan(it) }
            "dlna" -> group.dlnaRenderer?.let { onCastToDlna(it) }
        }
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 6.dp)
    ) {
        // Header con back + nome device
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(10.dp))
                .clickable(onClick = onBack)
                .padding(horizontal = 4.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                contentDescription = "Indietro",
                tint = Color.White,
                modifier = Modifier.size(22.dp)
            )
            Spacer(modifier = Modifier.width(8.dp))
            Icon(
                imageVector = Icons.Filled.Tv,
                contentDescription = null,
                tint = Color.White,
                modifier = Modifier.size(20.dp)
            )
            Spacer(modifier = Modifier.width(12.dp))
            Text(
                text = group.name,
                color = Color.White,
                fontWeight = FontWeight.Medium,
                fontSize = 15.sp,
                modifier = Modifier.weight(1f)
            )
        }
        Spacer(modifier = Modifier.height(6.dp))
        ProtocolConnectRow(
            label = "Obsidian",
            badge = "Raccomandato",
            preferred = savedPref == "streamo",
            onClick = { connect("streamo") }
        )
        ProtocolConnectRow(
            label = "DLNA",
            badge = null,
            preferred = savedPref == "dlna",
            onClick = { connect("dlna") }
        )
        // L'intera riga toggla; il Checkbox è solo indicatore (no doppio handler).
        Row(
            modifier = Modifier
                .padding(start = 28.dp)
                .clickable {
                    rememberChoice = !rememberChoice
                    if (!rememberChoice) onRemember(group.key, "")
                },
            verticalAlignment = Alignment.CenterVertically
        ) {
            Checkbox(
                checked = rememberChoice,
                onCheckedChange = null
            )
            Text(
                text = "Ricorda la scelta",
                color = Color.White.copy(alpha = 0.7f),
                fontSize = 13.sp
            )
        }
    }
}

/** Voce-intestazione del device (icona TV + nome): tap apre il pannello-dettaglio. */
@Composable
private fun DeviceHeaderRow(name: String, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(
            imageVector = Icons.Filled.Tv,
            contentDescription = null,
            tint = Color.White,
            modifier = Modifier.size(20.dp)
        )
        Spacer(modifier = Modifier.width(12.dp))
        Text(
            text = name,
            color = Color.White,
            fontWeight = FontWeight.Medium,
            fontSize = 15.sp,
            modifier = Modifier.weight(1f)
        )
    }
}

/**
 * Voce protocollo cliccabile: il click connette immediatamente. Aspetto da pulsante-lista
 * (icona cast + label + eventuale badge "Raccomandato" + check se è il preferito salvato).
 */
@Composable
private fun ProtocolConnectRow(
    label: String,
    badge: String?,
    preferred: Boolean,
    onClick: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 28.dp, top = 2.dp, bottom = 2.dp)
            .clip(RoundedCornerShape(10.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        Icon(
            imageVector = Icons.Filled.Cast,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.primary,
            modifier = Modifier.size(20.dp)
        )
        Text(
            text = label,
            color = Color.White,
            fontSize = 15.sp,
            fontWeight = FontWeight.Medium
        )
        if (badge != null) {
            Text(
                text = badge,
                color = MaterialTheme.colorScheme.primary,
                fontSize = 11.sp,
                fontWeight = FontWeight.Medium
            )
        }
        Spacer(modifier = Modifier.weight(1f))
        if (preferred) {
            Icon(
                imageVector = Icons.Filled.Check,
                contentDescription = "Preferito",
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(18.dp)
            )
        }
    }
}
