package com.streamo.app.player.dlna

import android.net.Uri
import android.os.Looper
import androidx.media3.common.C
import androidx.media3.common.DeviceInfo
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.common.SimpleBasePlayer
import androidx.media3.common.util.UnstableApi
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture

/**
 * Player media3 "finto" che rappresenta la riproduzione su TV via DLNA. Viene messo al
 * posto dell'ExoPlayer nella MediaSession durante il cast, così il sistema mostra la
 * notifica media (titolo, copertina, play/pausa, seek) e i suoi comandi pilotano la TV.
 *
 * Non riproduce nulla in locale: stato (posizione/durata/play) arriva dai provider, i
 * comandi vengono inoltrati ai callback (che chiamano le SOAP DLNA).
 */
@UnstableApi
class DlnaSessionPlayer(
    looper: Looper,
    private val title: String,
    private val artist: String?,
    private val artworkUri: Uri?,
    private val isPlayingProvider: () -> Boolean,
    private val positionProvider: () -> Long,
    private val durationProvider: () -> Long,
    private val onSetPlayWhenReady: (Boolean) -> Unit,
    private val onSeekTo: (Long) -> Unit,
    private val onStop: () -> Unit
) : SimpleBasePlayer(looper) {

    private val commands = Player.Commands.Builder()
        .addAll(
            Player.COMMAND_PLAY_PAUSE,
            Player.COMMAND_SEEK_BACK,
            Player.COMMAND_SEEK_FORWARD,
            Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM,
            Player.COMMAND_SEEK_TO_DEFAULT_POSITION,
            Player.COMMAND_GET_CURRENT_MEDIA_ITEM,
            Player.COMMAND_GET_METADATA,
            Player.COMMAND_GET_TIMELINE,
            Player.COMMAND_STOP
        )
        .build()

    /** Forza la MediaSession a rileggere lo stato (posizione/play) e aggiornare la notifica. */
    fun refresh() = invalidateState()

    override fun getState(): State {
        val item = MediaItem.Builder()
            .setMediaId("dlna")
            .setMediaMetadata(
                MediaMetadata.Builder()
                    .setTitle(title)
                    .setArtist(artist)
                    .setArtworkUri(artworkUri)
                    .build()
            )
            .build()
        val durMs = durationProvider()
        val durUs = if (durMs > 0) durMs * 1000 else C.TIME_UNSET
        return State.Builder()
            .setAvailableCommands(commands)
            // PLAYBACK_TYPE_REMOTE: la riproduzione avviene sulla TV, non sul telefono. Senza
            // questo, il default (LOCAL) fa dichiarare alla MediaSession Media3 una sessione
            // audio locale al framework, che allora reclama la route "Telefono" — deselezionando
            // (a volte, per una race sull'handshake Cast) la route TV appena scelta e uccidendo
            // la CastSession subito dopo l'avvio.
            .setDeviceInfo(DeviceInfo.Builder(DeviceInfo.PLAYBACK_TYPE_REMOTE).build())
            .setPlaybackState(Player.STATE_READY)
            .setPlayWhenReady(isPlayingProvider(), Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST)
            .setContentPositionMs(positionProvider().coerceAtLeast(0L))
            .setPlaylist(
                listOf(
                    MediaItemData.Builder("dlna")
                        .setMediaItem(item)
                        .setDurationUs(durUs)
                        .build()
                )
            )
            .setCurrentMediaItemIndex(0)
            .build()
    }

    override fun handleSetPlayWhenReady(playWhenReady: Boolean): ListenableFuture<*> {
        onSetPlayWhenReady(playWhenReady)
        return Futures.immediateVoidFuture()
    }

    override fun handleSeek(mediaItemIndex: Int, positionMs: Long, seekCommand: Int): ListenableFuture<*> {
        onSeekTo(if (positionMs == C.TIME_UNSET) 0L else positionMs)
        return Futures.immediateVoidFuture()
    }

    override fun handleStop(): ListenableFuture<*> {
        onStop()
        return Futures.immediateVoidFuture()
    }
}
