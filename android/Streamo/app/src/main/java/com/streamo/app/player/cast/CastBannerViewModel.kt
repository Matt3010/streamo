package com.streamo.app.player.cast

import androidx.lifecycle.ViewModel
import androidx.media3.common.util.UnstableApi
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject

/** Espone lo stato del [CastController] al banner globale di trasmissione. */
@UnstableApi
@HiltViewModel
class CastBannerViewModel @Inject constructor(
    private val castController: CastController
) : ViewModel() {

    val session = castController.session
    val isPlaying = castController.isPlaying

    fun togglePlay() = castController.togglePlay()
    fun stop() = castController.stop()
}
