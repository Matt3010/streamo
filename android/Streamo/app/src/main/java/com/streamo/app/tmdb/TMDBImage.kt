package com.streamo.app.tmdb

object TMDBImage {
    private const val BASE = "https://image.tmdb.org/t/p/"

    enum class Size(val path: String) {
        W92("w92"),
        W154("w154"),
        W185("w185"),
        W300("w300"),
        W342("w342"),
        W500("w500"),
        W780("w780"),
        W1280("w1280"),
        ORIGINAL("original")
    }

    fun url(path: String?, size: Size = Size.W500): String? {
        if (path.isNullOrBlank()) return null
        return "$BASE${size.path}$path"
    }
}
