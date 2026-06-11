package com.streamo.app.provider

import android.util.Log
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.CopyOnWriteArrayList

/**
 * Logger in-memory per debuggare la pipeline di risoluzione del provider.
 * I log vengono accumulati per sessione e possono essere letti dall'UI
 * per diagnosticare errori di streaming.
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
