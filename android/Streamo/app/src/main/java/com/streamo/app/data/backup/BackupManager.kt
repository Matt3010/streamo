package com.streamo.app.data.backup

import android.content.Context
import android.net.Uri
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import com.streamo.app.data.local.dao.HistoryDao
import com.streamo.app.data.local.dao.ProgressDao
import com.streamo.app.data.local.dao.WatchlistDao
import com.streamo.app.data.local.entity.HistoryEntry
import com.streamo.app.data.local.entity.ProgressEntry
import com.streamo.app.data.local.entity.WatchlistEntry
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class BackupManager @Inject constructor(
    @ApplicationContext private val context: Context,
    private val watchlistDao: WatchlistDao,
    private val progressDao: ProgressDao,
    private val historyDao: HistoryDao,
    private val gson: Gson
) {

    data class BackupPayload(
        val watchlist: List<WatchlistEntry>,
        val progress: List<ProgressEntry>,
        val history: List<HistoryEntry>
    )

    suspend fun export(uri: Uri): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            val payload = BackupPayload(
                watchlist = watchlistDao.getAll().first(),
                progress = progressDao.getAll().first(),
                history = historyDao.getAll().first()
            )
            val json = gson.toJson(payload)
            context.contentResolver.openOutputStream(uri)?.use { out ->
                OutputStreamWriter(out).use { writer ->
                    writer.write(json)
                }
            }
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun import(uri: Uri): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            val json = context.contentResolver.openInputStream(uri)?.use { stream ->
                BufferedReader(InputStreamReader(stream)).use { it.readText() }
            } ?: return@withContext Result.failure(IllegalStateException("Cannot open stream"))
            val type = object : TypeToken<BackupPayload>() {}.type
            val payload: BackupPayload = gson.fromJson(json, type)

            payload.watchlist.forEach { watchlistDao.insert(it) }
            payload.progress.forEach { progressDao.insert(it) }
            payload.history.forEach { historyDao.insert(it) }

            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
}
