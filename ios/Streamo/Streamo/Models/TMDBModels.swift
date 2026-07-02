import Foundation

// Codable mirrors of the TMDB shapes the web app consumes (frontend
// media.model.ts). Only the fields actually used are decoded; TMDB returns
// many more. Optionals everywhere because TMDB is inconsistent between
// list/detail/movie/tv payloads.

struct TmdbGenre: Codable, Hashable, Identifiable, Sendable {
    let id: Int
    let name: String
}

struct TmdbCastMember: Codable, Hashable, Identifiable, Sendable {
    let id: Int
    let name: String
    let character: String?
    let order: Int?
    let profilePath: String?

    enum CodingKeys: String, CodingKey {
        case id, name, character, order
        case profilePath = "profile_path"
    }
}

struct TmdbCredits: Codable, Hashable, Sendable {
    let cast: [TmdbCastMember]?
}

struct TmdbVideo: Codable, Hashable, Identifiable, Sendable {
    let id: String
    let key: String?
    let name: String?
    let site: String?
    let type: String?
    let official: Bool?
    let publishedAt: String?

    enum CodingKeys: String, CodingKey {
        case id, key, name, site, type, official
        case publishedAt = "published_at"
    }
}

struct TmdbVideoCollection: Codable, Hashable, Sendable {
    let results: [TmdbVideo]?
}

struct TmdbEpisodeRef: Codable, Hashable, Sendable {
    let seasonNumber: Int?
    let episodeNumber: Int?
    let airDate: String?

    enum CodingKeys: String, CodingKey {
        case seasonNumber = "season_number"
        case episodeNumber = "episode_number"
        case airDate = "air_date"
    }
}

struct TmdbSeasonInfo: Codable, Hashable, Sendable {
    let seasonNumber: Int
    let episodeCount: Int?
    let name: String?
    let airDate: String?

    enum CodingKeys: String, CodingKey {
        case seasonNumber = "season_number"
        case episodeCount = "episode_count"
        case name
        case airDate = "air_date"
    }
}

struct TmdbEpisodeDetail: Codable, Hashable, Identifiable, Sendable {
    let episodeNumber: Int
    let seasonNumber: Int?
    let name: String?
    let overview: String?
    let stillPath: String?
    let airDate: String?
    let runtime: Int?

    var id: Int { episodeNumber }

    enum CodingKeys: String, CodingKey {
        case episodeNumber = "episode_number"
        case seasonNumber = "season_number"
        case name, overview, runtime
        case stillPath = "still_path"
        case airDate = "air_date"
    }

    /// Lightweight stub used when the season-details fetch fails — keeps the
    /// episode grid populated with bare numbers (mirrors web `episodeStubs`).
    static func stub(_ number: Int) -> TmdbEpisodeDetail {
        TmdbEpisodeDetail(episodeNumber: number, seasonNumber: nil, name: nil,
                          overview: nil, stillPath: nil, airDate: nil, runtime: nil)
    }
}

struct TmdbSeasonDetails: Codable, Sendable {
    let episodes: [TmdbEpisodeDetail]?
}

/// The big one — TMDB movie/tv item, used for both list cards and detail.
struct TmdbItem: Codable, Hashable, Identifiable, Sendable {
    let id: Int
    let mediaType: String?
    let title: String?
    let name: String?
    let posterPath: String?
    let backdropPath: String?
    let popularity: Double?
    let voteAverage: Double?
    let voteCount: Int?
    let releaseDate: String?
    let firstAirDate: String?
    let overview: String?
    let tagline: String?
    let runtime: Int?
    let episodeRunTime: [Int]?
    let numberOfSeasons: Int?
    let numberOfEpisodes: Int?
    let status: String?
    let genres: [TmdbGenre]?
    let credits: TmdbCredits?
    let videos: TmdbVideoCollection?
    let seasons: [TmdbSeasonInfo]?
    let lastEpisodeToAir: TmdbEpisodeRef?
    let nextEpisodeToAir: TmdbEpisodeRef?

    enum CodingKeys: String, CodingKey {
        case id, title, name, popularity, overview, tagline, runtime, status, genres, credits, videos, seasons
        case mediaType = "media_type"
        case posterPath = "poster_path"
        case backdropPath = "backdrop_path"
        case voteAverage = "vote_average"
        case voteCount = "vote_count"
        case releaseDate = "release_date"
        case firstAirDate = "first_air_date"
        case episodeRunTime = "episode_run_time"
        case numberOfSeasons = "number_of_seasons"
        case numberOfEpisodes = "number_of_episodes"
        case lastEpisodeToAir = "last_episode_to_air"
        case nextEpisodeToAir = "next_episode_to_air"
    }

    init(
        id: Int,
        mediaType: MediaType,
        title: String?,
        posterPath: String?,
        backdropPath: String? = nil,
        releaseDate: String? = nil,
        seasons: [TmdbSeasonInfo]? = nil,
        numberOfSeasons: Int? = nil,
        numberOfEpisodes: Int? = nil
    ) {
        self.id = id
        self.mediaType = mediaType.rawValue
        self.title = mediaType == .movie ? title : nil
        self.name = mediaType == .tv ? title : nil
        self.posterPath = posterPath
        self.backdropPath = backdropPath
        self.popularity = nil
        self.voteAverage = nil
        self.voteCount = nil
        self.releaseDate = mediaType == .movie ? releaseDate : nil
        self.firstAirDate = mediaType == .tv ? releaseDate : nil
        self.overview = nil
        self.tagline = nil
        self.runtime = nil
        self.episodeRunTime = nil
        self.numberOfSeasons = numberOfSeasons
        self.numberOfEpisodes = numberOfEpisodes
        self.status = nil
        self.genres = nil
        self.credits = nil
        self.videos = nil
        self.seasons = seasons
        self.lastEpisodeToAir = nil
        self.nextEpisodeToAir = nil
    }

    // MARK: Convenience

    /// Display title — movies use `title`, TV uses `name`.
    var displayTitle: String { title ?? name ?? "" }

    /// Release/first-air date string (whichever applies).
    var primaryDate: String? { releaseDate ?? firstAirDate }

    /// Release year as an Int, parsed from the date string.
    var year: Int? {
        guard let d = primaryDate, d.count >= 4 else { return nil }
        return Int(d.prefix(4))
    }
}

/// Generic TMDB list envelope (`{ results: [...] }`).
struct TmdbListResponse<T: Codable & Sendable>: Codable, Sendable {
    let results: [T]?
}
