package com.streamo.app.di

import android.content.Context
import coil.ImageLoader
import coil.disk.DiskCache
import coil.memory.MemoryCache
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * `ImageLoader` Coil singleton con disk cache esplicita (250 MB in
 * `cacheDir/image_cache`) e memory cache al 20% della memoria app. Permette alle
 * immagini TMDB già caricate di sopravvivere offline e offre un path di clear
 * esposto in Impostazioni → Spazio e cache.
 */
@Module
@InstallIn(SingletonComponent::class)
object ImageModule {

    @Provides
    @Singleton
    fun provideImageLoader(@ApplicationContext ctx: Context): ImageLoader =
        ImageLoader.Builder(ctx)
            .memoryCache {
                MemoryCache.Builder(ctx).maxSizePercent(0.20).build()
            }
            .diskCache {
                DiskCache.Builder()
                    .directory(ctx.cacheDir.resolve("image_cache"))
                    .maxSizeBytes(250L * 1024 * 1024)
                    .build()
            }
            .crossfade(true)
            .build()
}