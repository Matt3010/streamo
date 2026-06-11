package com.streamo.app.di

import android.content.Context
import androidx.room.Room
import com.streamo.app.data.local.AppDatabase
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
    fun provideDatabase(@ApplicationContext context: Context): AppDatabase {
        return Room.databaseBuilder(
            context,
            AppDatabase::class.java,
            "streamo.db"
        )
            .addMigrations(
                AppDatabase.MIGRATION_5_6,
                AppDatabase.MIGRATION_6_7,
                AppDatabase.MIGRATION_7_8,
                AppDatabase.MIGRATION_8_9,
                AppDatabase.MIGRATION_9_10,
                AppDatabase.MIGRATION_10_11
            )
            .build()
    }

    @Provides
    fun provideWatchlistDao(db: AppDatabase) = db.watchlistDao()

    @Provides
    fun provideProgressDao(db: AppDatabase) = db.progressDao()

    @Provides
    fun provideHistoryDao(db: AppDatabase) = db.historyDao()

    @Provides
    fun provideProviderMappingDao(db: AppDatabase) = db.providerMappingDao()

    @Provides
    fun provideDownloadDao(db: AppDatabase) = db.downloadDao()

    @Provides
    fun provideSearchHistoryDao(db: AppDatabase) = db.searchHistoryDao()
}
