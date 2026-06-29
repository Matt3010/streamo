package com.streamo.app.data.local

import androidx.room.Database
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import com.streamo.app.data.local.dao.DownloadDao
import com.streamo.app.data.local.dao.HistoryDao
import com.streamo.app.data.local.dao.ProgressDao
import com.streamo.app.data.local.dao.ProviderMappingDao
import com.streamo.app.data.local.dao.SearchHistoryDao
import com.streamo.app.data.local.dao.WatchlistDao
import com.streamo.app.data.local.entity.DownloadEntry
import com.streamo.app.data.local.entity.HistoryEntry
import com.streamo.app.data.local.entity.ProgressEntry
import com.streamo.app.data.local.entity.ProviderMappingEntity
import com.streamo.app.data.local.entity.SearchHistoryEntry
import com.streamo.app.data.local.entity.WatchlistEntry

@Database(
    entities = [
        WatchlistEntry::class,
        ProgressEntry::class,
        HistoryEntry::class,
        ProviderMappingEntity::class,
        DownloadEntry::class,
        SearchHistoryEntry::class
    ],
    version = 13,
    exportSchema = false
)
abstract class AppDatabase : RoomDatabase() {

    companion object {
        /**
         * Aggiunge a `progress` le colonne per il resume degli anime: l'id episodio
         * AnimeUnity e lo slug (per l'header Referer dell'embed vixcloud). Permette di
         * riprendere un anime dal "Continua a guardare" saltando la ri-dettaglio.
         * Gli anime sono discriminati da `mediaType = "anime"` (nessuna colonna source).
         */
        val MIGRATION_12_13 = object : Migration(12, 13) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE progress ADD COLUMN providerEpisodeId INTEGER")
                db.execSQL("ALTER TABLE progress ADD COLUMN providerSlug TEXT")
            }
        }

        val MIGRATION_11_12 = object : Migration(11, 12) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    """CREATE TABLE history_new (
                        tmdbId INTEGER NOT NULL,
                        mediaType TEXT NOT NULL,
                        title TEXT NOT NULL,
                        posterPath TEXT,
                        season INTEGER NOT NULL DEFAULT 0,
                        episode INTEGER NOT NULL DEFAULT 0,
                        watchedAt INTEGER NOT NULL DEFAULT 0,
                        watchedDay INTEGER NOT NULL DEFAULT 0,
                        progressSeconds REAL NOT NULL DEFAULT 0.0,
                        durationSeconds REAL NOT NULL DEFAULT 0.0,
                        PRIMARY KEY(tmdbId, mediaType, season, episode, watchedDay)
                    )""".trimIndent()
                )
                db.execSQL(
                    """INSERT INTO history_new (
                        tmdbId, mediaType, title, posterPath, season, episode,
                        watchedAt, watchedDay, progressSeconds, durationSeconds
                    ) SELECT
                        h.tmdbId, h.mediaType, h.title, h.posterPath, h.season, h.episode,
                        h.watchedAt,
                        (h.watchedAt / 86400000) * 86400000,
                        COALESCE(p.positionSeconds, 0.0),
                        COALESCE(p.durationSeconds, 0.0)
                    FROM history h
                    LEFT JOIN progress p ON h.tmdbId = p.tmdbId
                        AND h.mediaType = p.mediaType
                        AND h.season = p.season
                        AND h.episode = p.episode""".trimIndent()
                )
                db.execSQL("DROP TABLE history")
                db.execSQL("ALTER TABLE history_new RENAME TO history")
            }
        }

        val MIGRATION_10_11 = object : Migration(10, 11) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE downloads ADD COLUMN warpEnabled INTEGER NOT NULL DEFAULT 0")
            }
        }

        val MIGRATION_9_10 = object : Migration(9, 10) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE downloads ADD COLUMN stillPath TEXT")
            }
        }

        val MIGRATION_8_9 = object : Migration(8, 9) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE downloads ADD COLUMN bytesPerSecond INTEGER NOT NULL DEFAULT 0")
            }
        }

        val MIGRATION_7_8 = object : Migration(7, 8) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    """CREATE TABLE search_history (
                        query TEXT NOT NULL PRIMARY KEY,
                        searchedAt INTEGER NOT NULL DEFAULT 0
                    )""".trimIndent()
                )
            }
        }

        val MIGRATION_6_7 = object : Migration(6, 7) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE downloads ADD COLUMN retryCount INTEGER NOT NULL DEFAULT 0")
            }
        }

        val MIGRATION_5_6 = object : Migration(5, 6) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    """CREATE TABLE progress_new (
                        tmdbId INTEGER NOT NULL,
                        mediaType TEXT NOT NULL,
                        season INTEGER NOT NULL DEFAULT 0,
                        episode INTEGER NOT NULL DEFAULT 0,
                        positionSeconds REAL NOT NULL DEFAULT 0.0,
                        durationSeconds REAL NOT NULL DEFAULT 0.0,
                        title TEXT NOT NULL DEFAULT '',
                        posterPath TEXT,
                        updatedAt INTEGER NOT NULL DEFAULT 0,
                        PRIMARY KEY(tmdbId, mediaType, season, episode)
                    )""".trimIndent()
                )
                db.execSQL(
                    """INSERT INTO progress_new (
                        tmdbId, mediaType, season, episode,
                        positionSeconds, durationSeconds, title, posterPath, updatedAt
                    ) SELECT
                        tmdbId, mediaType, season, episode,
                        positionSeconds, durationSeconds, title, posterPath, updatedAt
                    FROM progress""".trimIndent()
                )
                db.execSQL("DROP TABLE progress")
                db.execSQL("ALTER TABLE progress_new RENAME TO progress")
            }
        }
    }
    abstract fun watchlistDao(): WatchlistDao
    abstract fun progressDao(): ProgressDao
    abstract fun historyDao(): HistoryDao
    abstract fun providerMappingDao(): ProviderMappingDao
    abstract fun downloadDao(): DownloadDao
    abstract fun searchHistoryDao(): SearchHistoryDao
}
