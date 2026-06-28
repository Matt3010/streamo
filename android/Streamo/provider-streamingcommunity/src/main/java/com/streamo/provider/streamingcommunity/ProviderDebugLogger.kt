package com.streamo.provider.streamingcommunity

import android.util.Log
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.CopyOnWriteArrayList

/**
 * In-memory logger for the StreamingCommunity resolution pipeline, local to the
 * extension process. The host reads recent lines via the `debugLogs()` AIDL
 * method to surface them in its log viewer.
 */
object ProviderDebugLogger {
    private const val TAG = "ProviderPipeline"
    private val logs = CopyOnWriteArrayList<String>()
    private val dateFormat = SimpleDateFormat("HH:mm:ss.SSS", Locale.ITALY)

    fun log(message: String) {
        val line = "[${dateFormat.format(Date())}] $message"
        logs.add(line)
        Log.d(TAG, line)
    }

    fun logError(message: String, throwable: Throwable? = null) {
        val line = "[${dateFormat.format(Date())}] ERROR: $message"
        logs.add(line)
        Log.e(TAG, line, throwable)
    }

    fun getLogs(): String = logs.joinToString("\n")

    fun clear() {
        logs.clear()
    }
}
