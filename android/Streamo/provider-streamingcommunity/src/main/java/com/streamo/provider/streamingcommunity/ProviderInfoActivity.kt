package com.streamo.provider.streamingcommunity

import android.app.Activity
import android.os.Bundle
import android.view.Gravity
import android.widget.TextView

/**
 * Minimal info screen so the extension APK is installable/visible. It does no
 * work itself — resolution happens in [StreamProviderService], which the Streamo
 * catalog app binds to.
 */
class ProviderInfoActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val text = TextView(this).apply {
            text = "Provider StreamingCommunity installato.\n\n" +
                "Apri l'app Streamo per riprodurre i contenuti: " +
                "questo modulo fornisce solo le sorgenti di streaming."
            textSize = 16f
            gravity = Gravity.CENTER
            setPadding(48, 48, 48, 48)
        }
        setContentView(text)
    }
}
