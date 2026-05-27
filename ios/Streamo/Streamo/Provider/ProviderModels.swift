import Foundation

// Wire + domain types for the streamingcommunity provider resolution.
// Port of the relevant pieces of server/src/services/provider-resolver.ts.

/// A confirmed streamingcommunity title mapped to a TMDB id.
struct ProviderResolvedTitle: Hashable, Sendable {
    let id: Int
    let slug: String?
    let title: String
    let mediaType: MediaType
}

/// A picker candidate (weak / alternative matches) — persisted as JSON in
/// `ProviderMapping.candidatesJSON`.
struct ProviderCandidate: Codable, Hashable, Identifiable, Sendable {
    let providerTitleId: Int
    let providerSlug: String?
    let title: String
    let year: Int?
    let score: Int
    var posterUrl: String?

    var id: Int { providerTitleId }
}

enum ProviderMatchStatus: String, Codable, Sendable {
    case autoConfirmed = "auto_confirmed"
    case manualConfirmed = "manual_confirmed"
    case failed
}

/// Outcome of resolving a TMDB title to a provider title.
struct ProviderResolveTitleOutcome: Sendable {
    var resolved: ProviderResolvedTitle?
    var reason: ProviderResolveFailureReason?
    var candidates: [ProviderCandidate]
    var matchStatus: ProviderMatchStatus?
}

/// Outcome of resolving a movie/episode embed.
struct ProviderEmbedOutcome: Sendable {
    /// Absolute vixcloud embed URL (e.g. https://vixcloud.co/embed/<id>?...).
    var embedUrl: String?
    var reason: ProviderResolveFailureReason?
}

// MARK: - Decodable payloads (Inertia data-page JSON)

/// Titles can arrive as a bare array or wrapped in `{ data: [...] }`.
struct ProviderTitlesContainer: Decodable, Sendable {
    let titles: [ProviderSearchTitle]

    init(from decoder: Decoder) throws {
        if let array = try? [ProviderSearchTitle](from: decoder) {
            titles = array
            return
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        titles = (try? container.decode([ProviderSearchTitle].self, forKey: .data)) ?? []
    }

    enum CodingKeys: String, CodingKey { case data }
}

struct ProviderTranslation: Decodable, Sendable {
    let key: String?
    let value: String?
}

struct ProviderSearchTitle: Decodable, Sendable {
    let id: Int?
    let slug: String?
    let name: String?
    let type: String?
    let lastAirDate: String?
    let translations: [ProviderTranslation]?
}

struct ProviderSearchPage: Decodable, Sendable {
    struct Props: Decodable, Sendable { let titles: ProviderTitlesContainer? }
    let props: Props?
}

struct ProviderSeasonSummary: Decodable, Sendable {
    let id: Int?
    let number: Int?
    let episodesCount: Int?
}

struct ProviderEpisode: Decodable, Sendable {
    let id: Int?
    let number: Int?
    let scwsId: Int?
    let seasonId: Int?
}

struct ProviderLoadedSeason: Decodable, Sendable {
    let id: Int?
    let number: Int?
    let episodes: [ProviderEpisode]?
}

struct ProviderTitlePage: Decodable, Sendable {
    struct TitleObj: Decodable, Sendable { let seasons: [ProviderSeasonSummary]? }
    struct Props: Decodable, Sendable {
        let title: TitleObj?
        let loadedSeason: ProviderLoadedSeason?
    }
    let props: Props?
}

// MARK: - telegra.ph link-source payload

struct TelegraphResponse: Decodable, Sendable {
    struct Result: Decodable, Sendable { let content: [TelegraphNode]? }
    let result: Result?
}

/// A telegra.ph content node. `children` may contain raw strings or nested
/// nodes, so it's modelled as a heterogeneous enum.
struct TelegraphNode: Decodable, Sendable {
    struct Attrs: Decodable, Sendable { let href: String? }
    let tag: String?
    let attrs: Attrs?
    let children: [Child]?

    enum Child: Decodable, Sendable {
        case text(String)
        case node(TelegraphNode)

        init(from decoder: Decoder) throws {
            let single = try decoder.singleValueContainer()
            if let s = try? single.decode(String.self) {
                self = .text(s)
            } else {
                self = .node(try single.decode(TelegraphNode.self))
            }
        }
    }
}
