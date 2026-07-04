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
import com.streamo.app.data.local.dao.TmdbCacheDao
import com.streamo.app.data.local.dao.WatchlistDao
import com.streamo.app.data.local.entity.DownloadEntry
import com.streamo.app.data.local.entity.HistoryEntry
import com.streamo.app.data.local.entity.ProgressEntry
import com.streamo.app.data.local.entity.ProviderMappingEntity
import com.streamo.app.data.local.entity.SearchHistoryEntry
import com.streamo.app.data.local.entity.TmdbCacheEntry
import com.streamo.app.data.local.entity.WatchlistEntry

@Database(
    entities = [
        WatchlistEntry::class,
        ProgressEntry::class,
        HistoryEntry::class,
        ProviderMappingEntity::class,
        DownloadEntry::class,
        SearchHistoryEntry::class,
        TmdbCacheEntry::class
    ],
    version = 15,
    exportSchema = false
)
abstract class AppDatabase : RoomDatabase() {

    companion object {
        /**
         * `watchlist` ora ha chiave composita (tmdbId, mediaType): un film e una
         * serie possono condividere lo stesso tmdbId (spazi ID TMDB separati), e la
         * vecchia PK solo su tmdbId li faceva collidere (l'aggiunta dell'uno
         * sovrascriveva/segnava come presente l'altro).
         */
        val MIGRATION_14_15 = object : Migration(14, 15) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    """CREATE TABLE watchlist_new (
                        tmdbId INTEGER NOT NULL,
                        mediaType TEXT NOT NULL,
                        title TEXT NOT NULL,
                        posterPath TEXT,
                        addedAt INTEGER NOT NULL,
                        PRIMARY KEY(tmdbId, mediaType)
                    )""".trimIndent()
                )
                db.execSQL(
                    """INSERT OR IGNORE INTO watchlist_new (tmdbId, mediaType, title, posterPath, addedAt)
                       SELECT tmdbId, mediaType, title, posterPath, addedAt FROM watchlist""".trimIndent()
                )
                db.execSQL("DROP TABLE watchlist")
                db.execSQL("ALTER TABLE watchlist_new RENAME TO watchlist")
            }
        }

        /**
         * Tabella `tmdb_cache`: cache persistente TTL delle risposte TMDB per la
         * navigazione offline. Chiave unica per richiesta, `type` per cancellazione
         * selettiva, payload JSON + fetchedAt + ttlSeconds per la freschezza.
         */
        val MIGRATION_13_14 = object : Migration(13, 14) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    """CREATE TABLE IF NOT EXISTS tmdb_cache (
                        key TEXT NOT NULL PRIMARY KEY,
                        type TEXT NOT NULL,
                        payload TEXT NOT NULL,
                        fetchedAt INTEGER NOT NULL,
                        ttlSeconds INTEGER NOT NULL
                    )""".trimIndent()
                )
                db.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS index_tmdb_cache_key ON tmdb_cache(key)")
                db.execSQL("CREATE INDEX IF NOT EXISTS index_tmdb_cache_type ON tmdb_cache(type)")
            }
        }

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
    abstract fun tmdbCacheDao(): TmdbCacheDao
}
