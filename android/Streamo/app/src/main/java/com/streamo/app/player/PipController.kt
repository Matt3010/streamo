package com.streamo.app.player

import kotlinx.coroutines.flow.MutableStateFlow

/**
 * Bridges the Activity-level Picture-in-Picture state to the Compose player UI.
 * MainActivity publishes mode changes here; PlayerScreen observes it to hide the
 * playback controls while the window is in PiP.
 */
object PipController {
    val inPipMode = MutableStateFlow(false)
}
