package com.streamo.app.ui.home

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.LocalFireDepartment
import androidx.compose.material.icons.filled.Movie
import androidx.compose.material.icons.filled.Radio
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.Tv
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.ui.graphics.vector.ImageVector

data class HomeSection(
    val id: String,
    val mediaType: String,
    val title: String,
    val icon: ImageVector,
    val endpoint: String
)

object HomeSections {
    val all: List<HomeSection> = listOf(
        HomeSection("movie-trending", "movie", "Film di tendenza", Icons.Filled.LocalFireDepartment, "trending/movie/day"),
        HomeSection("tv-trending", "tv", "Serie TV di tendenza", Icons.Filled.LocalFireDepartment, "trending/tv/day"),
        HomeSection("movie-now_playing", "movie", "Al cinema", Icons.Filled.Movie, "movie/now_playing"),
        HomeSection("tv-on_the_air", "tv", "Serie TV in onda", Icons.Filled.Tv, "tv/on_the_air"),
        HomeSection("movie-popular", "movie", "Film più visti", Icons.Filled.Visibility, "movie/popular"),
        HomeSection("tv-popular", "tv", "Serie TV più viste", Icons.Filled.Visibility, "tv/popular"),
        HomeSection("movie-upcoming", "movie", "Film in arrivo", Icons.Filled.CalendarMonth, "movie/upcoming"),
        HomeSection("tv-top_rated", "tv", "Serie TV più votate", Icons.Filled.Star, "tv/top_rated"),
        HomeSection("tv-airing_today", "tv", "Oggi in TV", Icons.Filled.Radio, "tv/airing_today")
    )
}
