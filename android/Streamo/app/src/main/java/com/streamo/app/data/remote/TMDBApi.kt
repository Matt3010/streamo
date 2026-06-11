package com.streamo.app.data.remote

import com.streamo.app.data.remote.dto.TmdbItem
import com.streamo.app.data.remote.dto.TmdbListResponse
import com.streamo.app.data.remote.dto.TmdbReview
import com.streamo.app.data.remote.dto.TmdbSeasonDetails
import retrofit2.http.GET
import retrofit2.http.Path
import retrofit2.http.Query
import retrofit2.http.QueryMap

interface TMDBApi {

    @GET("{endpoint}")
    suspend fun list(
        // endpoint contains a slash (e.g. "movie/upcoming"); encoded=true stops Retrofit
        // turning the "/" into "%2F", which TMDB would 404.
        @Path(value = "endpoint", encoded = true) endpoint: String,
        @Query("api_key") apiKey: String,
        @Query("language") language: String = "it-IT",
        @Query("region") region: String = "IT",
        @Query("page") page: Int = 1
    ): TmdbListResponse<TmdbItem>

    @GET("{type}/{id}")
    suspend fun details(
        @Path("type") type: String,
        @Path("id") id: Int,
        @Query("api_key") apiKey: String,
        @Query("append_to_response") append: String = "credits,videos",
        @Query("language") language: String = "it-IT"
    ): TmdbItem

    @GET("tv/{id}/season/{season}")
    suspend fun seasonDetails(
        @Path("id") tvId: Int,
        @Path("season") season: Int,
        @Query("api_key") apiKey: String,
        @Query("language") language: String = "it-IT"
    ): TmdbSeasonDetails

    @GET("{type}/{id}/recommendations")
    suspend fun recommendations(
        @Path("type") type: String,
        @Path("id") id: Int,
        @Query("api_key") apiKey: String,
        @Query("language") language: String = "it-IT"
    ): TmdbListResponse<TmdbItem>

    @GET("{type}/{id}/reviews")
    suspend fun reviews(
        @Path("type") type: String,
        @Path("id") id: Int,
        @Query("api_key") apiKey: String,
        @Query("language") language: String = "it-IT"
    ): TmdbListResponse<TmdbReview>

    @GET("search/multi")
    suspend fun searchMulti(
        @Query("api_key") apiKey: String,
        @Query("query") query: String,
        @Query("language") language: String = "it-IT",
        @Query("page") page: Int = 1
    ): TmdbListResponse<TmdbItem>
}
