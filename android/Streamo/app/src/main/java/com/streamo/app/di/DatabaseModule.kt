package com.streamo.app.di

import android.content.Context
import androidx.room.Room
import com.streamo.app.data.local.StreamoDatabase
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object DatabaseModule {

    @Provides
    @Singleton
    fun provideDatabase(@ApplicationContext context: Context): StreamoDatabase {
        return Room.databaseBuilder(
            context,
            StreamoDatabase::class.java,
            "streamo.db"
        )
            .addMigrations(
                StreamoDatabase.MIGRATION_5_6,
                StreamoDatabase.MIGRATION_6_7,
                StreamoDatabase.MIGRATION_7_8,
                StreamoDatabase.MIGRATION_8_9,
                StreamoDatabase.MIGRATION_9_10
            )
            .build()
    }

    @Provides
    fun provideWatchlistDao(db: StreamoDatabase) = db.watchlistDao()

    @Provides
    fun provideProgressDao(db: StreamoDatabase) = db.progressDao()

    @Provides
    fun provideHistoryDao(db: StreamoDatabase) = db.historyDao()

    @Provides
    fun provideProviderMappingDao(db: StreamoDatabase) = db.providerMappingDao()

    @Provides
    fun provideDownloadDao(db: StreamoDatabase) = db.downloadDao()

    @Provides
    fun provideSearchHistoryDao(db: StreamoDatabase) = db.searchHistoryDao()
}
