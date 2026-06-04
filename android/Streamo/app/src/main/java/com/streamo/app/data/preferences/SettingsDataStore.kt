package com.streamo.app.data.preferences

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.floatPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.streamo.app.BuildConfig
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SettingsDataStore @Inject constructor(
    @ApplicationContext private val context: Context
) {
    private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "streamo_settings")

    companion object {
        private val TMDB_API_KEY = stringPreferencesKey("tmdb_api_key")
        private val AUTOPLAY_NEXT = booleanPreferencesKey("autoplay_next")
        private val PROVIDER_LOCALE = stringPreferencesKey("provider_locale")
        private val FOLDERS_ENABLED = booleanPreferencesKey("folders_enabled")
        private val AUTO_DELETE_WATCHED = booleanPreferencesKey("auto_delete_watched_downloads")
        private val ACCENT_R = floatPreferencesKey("accent_r")
        private val ACCENT_G = floatPreferencesKey("accent_g")
        private val ACCENT_B = floatPreferencesKey("accent_b")

        val defaultAccent = Triple(0.898f, 0.035f, 0.078f)
    }

    val tmdbApiKey: Flow<String> = context.dataStore.data.map { prefs ->
        prefs[TMDB_API_KEY] ?: BuildConfig.DEFAULT_TMDB_API_KEY
    }

    suspend fun setTmdbApiKey(key: String) {
        context.dataStore.edit { it[TMDB_API_KEY] = key }
    }

    val autoplayNext: Flow<Boolean> = context.dataStore.data.map { prefs ->
        prefs[AUTOPLAY_NEXT] ?: true
    }

    suspend fun setAutoplayNext(value: Boolean) {
        context.dataStore.edit { it[AUTOPLAY_NEXT] = value }
    }

    val providerLocale: Flow<String> = context.dataStore.data.map { prefs ->
        prefs[PROVIDER_LOCALE] ?: "it"
    }

    suspend fun setProviderLocale(value: String) {
        context.dataStore.edit { it[PROVIDER_LOCALE] = value }
    }

    val foldersEnabled: Flow<Boolean> = context.dataStore.data.map { prefs ->
        prefs[FOLDERS_ENABLED] ?: true
    }

    suspend fun setFoldersEnabled(value: Boolean) {
        context.dataStore.edit { it[FOLDERS_ENABLED] = value }
    }

    val autoDeleteWatched: Flow<Boolean> = context.dataStore.data.map { prefs ->
        prefs[AUTO_DELETE_WATCHED] ?: false
    }

    suspend fun setAutoDeleteWatched(value: Boolean) {
        context.dataStore.edit { it[AUTO_DELETE_WATCHED] = value }
    }

    val accentColor: Flow<Triple<Float, Float, Float>> = context.dataStore.data.map { prefs ->
        Triple(
            prefs[ACCENT_R] ?: defaultAccent.first,
            prefs[ACCENT_G] ?: defaultAccent.second,
            prefs[ACCENT_B] ?: defaultAccent.third
        )
    }

    suspend fun setAccentColor(r: Float, g: Float, b: Float) {
        context.dataStore.edit {
            it[ACCENT_R] = r
            it[ACCENT_G] = g
            it[ACCENT_B] = b
        }
    }
}
