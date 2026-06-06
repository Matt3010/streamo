package com.streamo.app.util

import android.app.UiModeManager
import android.content.Context
import android.content.pm.PackageManager
import android.content.res.Configuration

/**
 * True when running on a TV-class device: Android TV (leanback),
 * Amazon Fire TV/Firestick, or a TV emulator.
 */
fun Context.isTvDevice(): Boolean {
    val uiModeManager = getSystemService(Context.UI_MODE_SERVICE) as? UiModeManager
    if (uiModeManager?.currentModeType == Configuration.UI_MODE_TYPE_TELEVISION) return true

    val pm = packageManager
    if (pm.hasSystemFeature(PackageManager.FEATURE_LEANBACK)) return true
    if (pm.hasSystemFeature("android.software.leanback_only")) return true   // FEATURE_LEANBACK_ONLY
    if (pm.hasSystemFeature("amazon.hardware.fire_tv")) return true          // Fire TV / Firestick
    return false
}