import Foundation

// Wire + domain types for the AnimeUnity provider. AnimeUnity is a native
// catalog (its own ids, no TMDB) surfaced in the dedicated "Anime" tab. Unlike
// StreamingCommunity it is Livewire/Blade (no Inertia `data-page` blob): the
// JSON endpoints (`/livesearch`, `/archivio/get-animes`, `/info_api`) are
// consumed directly. See reference_animeunity_api memory for the live shapes.

/// A catalog entry (one cour/season — AnimeUnity models each as a separate
/// record). `id`+`slug` form the `/anime/{id}-{slug}` path.
struct AUAnime: Decodable, Hashable, Identifiable, Sendable {
    let id: Int
    let slug: String?
    /// `title` is often null; `title_eng` is the reliable display name.
    let title: String?
    let titleEng: String?
    let titleIt: String?
    let type: String?            // TV | Movie | OVA | ONA | Special
    let episodesCount: Int?
    let imageurl: String?
    let imageurlCover: String?
    let plot: String?
    let date: String?            // release year as string, e.g. "2002"
    let status: String?          // "In corso" | "Terminato"
    let dub: Int?                // 0 = sub ita, 1 = dub ita
    let score: String?
    let studio: String?
    let malId: Int?
    let anilistId: Int?

    enum CodingKeys: String, CodingKey {
        case id, slug, title, type, plot, date, status, dub, score, studio
        case titleEng = "title_eng"
        case titleIt = "title_it"
        case episodesCount = "episodes_count"
        case imageurl
        case imageurlCover = "imageurl_cover"
        case malId = "mal_id"
        case anilistId = "anilist_id"
    }

    /// Best human-facing name (title_eng → title_it → title → slug).
    var displayTitle: String {
        for c in [titleEng, titleIt, title] {
            if let v = c?.trimmingCharacters(in: .whitespacesAndNewlines), !v.isEmpty { return v }
        }
        return slug ?? "Anime \(id)"
    }

    /// Release year parsed from `date`.
    var year: Int? { date.flatMap { Int($0.prefix(4)) } }

    var isDubbed: Bool { (dub ?? 0) == 1 }

    /// Minimal entry reconstructed from a saved continue-watching row — enough
    /// to push the detail page, which re-fetches episodes by id.
    static func stub(id: Int, title: String?, slug: String?, imageurl: String?) -> AUAnime {
        AUAnime(id: id, slug: slug, title: title, titleEng: nil, titleIt: nil, type: nil,
                episodesCount: nil, imageurl: imageurl, imageurlCover: nil, plot: nil, date: nil,
                status: nil, dub: nil, score: nil, studio: nil, malId: nil, anilistId: nil)
    }
}

/// One episode within an AUAnime. `scwsId` is the vixcloud stream id; `id` is
/// the AnimeUnity episode id used by `/embed-url/{id}`.
struct AUEpisode: Decodable, Hashable, Identifiable, Sendable {
    let id: Int
    /// Episode number — AnimeUnity sends it as a string ("1", "12.5", …).
    let number: String?
    let scwsId: Int?
    let fileName: String?
    let hidden: Int?

    enum CodingKeys: String, CodingKey {
        case id, number, hidden
        case scwsId = "scws_id"
        case fileName = "file_name"
    }

    var isHidden: Bool { (hidden ?? 0) != 0 }

    /// Integer episode number when parseable (drops fractional specials).
    var numberInt: Int? { number.flatMap { Int($0) } }
}

// MARK: - Endpoint responses

/// `POST /livesearch` and `POST /archivio/get-animes` both wrap records.
struct AURecordsResponse: Decodable, Sendable {
    let records: [AUAnime]?
    let tot: Int?
}

/// `GET /info_api/{animeId}/1?start_range&end_range`.
struct AUInfoResponse: Decodable, Sendable {
    let episodesCount: Int?
    let currentEpisode: Int?
    let episodes: [AUEpisode]?

    enum CodingKeys: String, CodingKey {
        case episodes
        case episodesCount = "episodes_count"
        case currentEpisode = "current_episode"
    }
}
