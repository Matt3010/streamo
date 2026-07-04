package com.streamo.app.data.local.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * Cache persistente su disco delle risposte TMDB già parseate. Permette la
 * navigazione offline: la chiave identifica la richiesta, `type` raggruppa per
 * categoria (per la cancellazione selettiva), `payload` è il JSON del DTO e
 * `fetchedAt` + `ttlSeconds` determinano la freschezza. Su rete assente con
 * riga scaduta si serve comunque lo stale (fallback offline).
 */
@Entity(
    tableName = "tmdb_cache",
    indices = [Index("type"), Index(value = ["key"], unique = true)]
)
data class TmdbCacheEntry(
    @PrimaryKey val key: String,
    val type: String,
    val payload: String,
    val fetchedAt: Long,
    val ttlSeconds: Long
)