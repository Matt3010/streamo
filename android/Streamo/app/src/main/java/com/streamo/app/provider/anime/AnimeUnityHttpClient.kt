package com.streamo.app.provider.anime

import javax.inject.Qualifier

/**
 * Marks the OkHttp client dedicated to AnimeUnity. It carries a cookie jar
 * (for the `animeunity_session` cookie paired with the CSRF token) and is kept
 * separate from the TMDB/StreamingCommunity client, which has no cookie jar.
 */
@Qualifier
@Retention(AnnotationRetention.BINARY)
annotation class AnimeUnityHttpClient