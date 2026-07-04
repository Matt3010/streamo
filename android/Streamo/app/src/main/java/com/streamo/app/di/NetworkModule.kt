package com.streamo.app.di

import com.google.gson.FieldNamingPolicy
import com.google.gson.Gson
import com.google.gson.GsonBuilder
import com.streamo.app.BuildConfig
import com.streamo.app.data.preferences.SettingsDataStore
import com.streamo.app.data.remote.TMDBApi
import com.streamo.app.provider.anime.AnimeUnityClient
import com.streamo.app.provider.anime.AnimeUnityCookieJar
import com.streamo.app.provider.anime.AnimeUnityHttpClient
import com.streamo.app.tmdb.TMDBClient
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object NetworkModule {

    @Provides
    @Singleton
    fun provideGson(): Gson = GsonBuilder()
        .setFieldNamingPolicy(FieldNamingPolicy.LOWER_CASE_WITH_UNDERSCORES)
        .create()

    @Provides
    @Singleton
    fun provideOkHttpClient(): OkHttpClient {
        val logging = HttpLoggingInterceptor().apply {
            level = if (BuildConfig.DEBUG) {
                HttpLoggingInterceptor.Level.BODY
            } else {
                HttpLoggingInterceptor.Level.NONE
            }
        }
        return OkHttpClient.Builder()
            .addInterceptor(logging)
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(15, TimeUnit.SECONDS)
            .build()
    }

    @Provides
    @Singleton
    fun provideRetrofit(okHttpClient: OkHttpClient, gson: Gson): Retrofit {
        return Retrofit.Builder()
            .baseUrl("https://api.themoviedb.org/3/")
            .client(okHttpClient)
            .addConverterFactory(GsonConverterFactory.create(gson))
            .build()
    }

    @Provides
    @Singleton
    fun provideTMDBApi(retrofit: Retrofit): TMDBApi = retrofit.create(TMDBApi::class.java)

    // TMDBClient ha costruttore @Inject: Hilt risolve api, settings, TmdbCacheDao, Gson
    // automaticamente (i provider sono in DatabaseModule e NetworkModule.provideGson).

    // --- AnimeUnity (catalogo nativo, separato da TMDB) ---

    /** Cookie jar condiviso fra il client diretto e quello proxato WARP: il
     *  cookie `animeunity_session` (pair del token CSRF) deve sopravvivere allo
     *  swap del client sottostante. */
    @Provides
    @Singleton
    fun provideAnimeUnityCookieJar(): AnimeUnityCookieJar = AnimeUnityCookieJar()

    @Provides
    @Singleton
    @AnimeUnityHttpClient
    fun provideAnimeUnityOkHttp(cookieJar: AnimeUnityCookieJar): OkHttpClient {
        val logging = HttpLoggingInterceptor().apply {
            // BASIC: i body POST AnimeUnity possono contenere token; non loggarli interi.
            level = if (BuildConfig.DEBUG) HttpLoggingInterceptor.Level.BASIC
            else HttpLoggingInterceptor.Level.NONE
        }
        return OkHttpClient.Builder()
            .cookieJar(cookieJar)
            .addInterceptor(logging)
            .connectTimeout(12, TimeUnit.SECONDS)
            .readTimeout(12, TimeUnit.SECONDS)
            .build()
    }

    @Provides
    @Singleton
    fun provideAnimeUnityClient(
        @AnimeUnityHttpClient client: OkHttpClient,
        cookieJar: AnimeUnityCookieJar,
        settings: SettingsDataStore
    ): AnimeUnityClient = AnimeUnityClient(client, cookieJar, settings)
}
