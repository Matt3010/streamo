package com.streamo.app.provider.anime

import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import java.util.concurrent.ConcurrentHashMap

/**
 * In-memory cookie jar for AnimeUnity. The Laravel/Livewire JSON endpoints need
 * the `animeunity_session` cookie captured from the homepage bootstrap, paired
 * with the CSRF token. OkHttp core ships no CookieJar implementation, so we keep
 * a tiny per-host store here instead of pulling in `okhttp-urlconnection`.
 *
 * Cookies are bound to the lifetime of this singleton; clearing the session
 * (WARP swap / base URL change) drops them when the client is rebuilt.
 */
class AnimeUnityCookieJar : CookieJar {

    private val store = ConcurrentHashMap<String, MutableList<Cookie>>()

    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        if (cookies.isEmpty()) return
        val list = store.getOrPut(url.host) { mutableListOf() }
        synchronized(list) {
            // Replace any cookie with the same name, then add the new ones.
            for (c in cookies) list.removeAll { it.name == c.name }
            list.addAll(cookies)
        }
    }

    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        val list = store[url.host] ?: return emptyList()
        return synchronized(list) {
            val now = System.currentTimeMillis()
            // Drop expired cookies on read (OkHttp persists none of this to disk).
            list.removeAll { it.expiresAt < now }
            list.filter { it.matches(url) }
        }
    }

    /** Drop every stored cookie (next request re-bootstraps the session). */
    fun clear() {
        store.clear()
    }
}