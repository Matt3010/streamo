package com.streamo.app.data.local.entity

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "search_history")
data class SearchHistoryEntry(
    @PrimaryKey val query: String,
    val searchedAt: Long = System.currentTimeMillis()
)
