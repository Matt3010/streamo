import Foundation
import CryptoKit
import Security

/// On-device registration of a free Cloudflare WARP account, producing a
/// WireGuard configuration the userspace tunnel (`WarpTunnel`) consumes.
///
/// Swift port of the registration step of `wgcf` (github.com/ViRb3/wgcf): we
/// generate a Curve25519 keypair locally and `POST` the public key to
/// Cloudflare's client API, which returns the peer endpoint + the IPs assigned
/// to us. The private key never leaves the device. The resulting config is
/// persisted in the Keychain (it contains the private key).
///
/// This replaces the `caomingjun/warp` Docker container: instead of a server
/// holding the WARP credentials, the phone registers its own account.
actor WarpAccount {
    static let shared = WarpAccount()

    // Pinned to the values wgcf uses — Cloudflare's client API gates on these.
    private static let apiBase = "https://api.cloudflareclient.com"
    private static let apiVersion = "v0a2158"
    private static let clientVersion = "a-6.11-2223"
    private static let userAgent = "okhttp/3.12.1"
    private static let keychainService = "com.streamo.warp"
    private static let keychainAccount = "warp-config"

    struct Config: Codable, Sendable {
        let privateKey: String       // base64, ours
        let publicKey: String        // base64, ours
        let peerPublicKey: String    // base64, Cloudflare
        let endpoint: String         // host:port
        let addressV4: String        // e.g. 172.16.0.2
        let addressV6: String        // e.g. 2606:4700:110:...
        let clientId: String?
        let registeredAt: Date
    }

    enum WarpError: Error, LocalizedError {
        case registrationFailed(String)
        case malformedResponse
        var errorDescription: String? {
            switch self {
            case .registrationFailed(let m): return "Registrazione WARP fallita: \(m)"
            case .malformedResponse: return "Risposta WARP non valida."
            }
        }
    }

    private var cached: Config?

    private init() {
        cached = Self.loadFromKeychain()
    }

    /// The current registered config, if any.
    var current: Config? { cached }
    var isRegistered: Bool { cached != nil }

    /// Register a fresh WARP account (overwrites any existing one). The HTTP
    /// call deliberately uses a plain session — it must NOT route through the
    /// tunnel it is bootstrapping.
    @discardableResult
    func register() async throws -> Config {
        let priv = Curve25519.KeyAgreement.PrivateKey()
        let privB64 = priv.rawRepresentation.base64EncodedString()
        let pubB64 = priv.publicKey.rawRepresentation.base64EncodedString()

        var request = URLRequest(url: URL(string: "\(Self.apiBase)/\(Self.apiVersion)/reg")!)
        request.httpMethod = "POST"
        request.timeoutInterval = 15
        request.setValue(Self.userAgent, forHTTPHeaderField: "User-Agent")
        request.setValue(Self.clientVersion, forHTTPHeaderField: "CF-Client-Version")
        request.setValue("application/json; charset=UTF-8", forHTTPHeaderField: "Content-Type")

        let tos = ISO8601DateFormatter().string(from: Date())
        let body: [String: String] = [
            "install_id": "",
            "fcm_token": "",
            "tos": tos,
            "key": pubB64,
            "type": "Android",
            "locale": "en_US",
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession(configuration: .ephemeral).data(for: request)
        guard let http = response as? HTTPURLResponse else { throw WarpError.malformedResponse }
        guard (200...299).contains(http.statusCode) else {
            throw WarpError.registrationFailed("HTTP \(http.statusCode)")
        }

        let reg = try JSONDecoder().decode(RegistrationResponse.self, from: data)
        guard let peer = reg.config?.peers?.first,
              let peerKey = peer.publicKey,
              let endpoint = peer.endpoint?.host ?? peer.endpoint?.v4,
              let v4 = reg.config?.interface?.addresses?.v4 else {
            throw WarpError.malformedResponse
        }

        let config = Config(
            privateKey: privB64,
            publicKey: pubB64,
            peerPublicKey: peerKey,
            endpoint: endpoint,
            addressV4: v4,
            addressV6: reg.config?.interface?.addresses?.v6 ?? "",
            clientId: reg.config?.clientId,
            registeredAt: Date()
        )
        cached = config
        Self.saveToKeychain(config)
        return config
    }

    /// Forget the registered account (Settings "rigenera" first clears).
    func clear() {
        cached = nil
        Self.deleteFromKeychain()
    }

    /// Build a `wireproxy`/`wiresocks`-style config that brings up the WARP
    /// tunnel and exposes a local HTTP proxy at `httpBind` (e.g.
    /// "127.0.0.1:51899"). Returns nil when not registered.
    func wireproxyConfig(httpBind: String) -> String? {
        guard let c = cached else { return nil }
        var address = "\(c.addressV4)/32"
        if !c.addressV6.isEmpty { address += ", \(c.addressV6)/128" }
        return """
        [Interface]
        PrivateKey = \(c.privateKey)
        Address = \(address)
        DNS = 1.1.1.1
        MTU = 1280

        [Peer]
        PublicKey = \(c.peerPublicKey)
        Endpoint = \(c.endpoint)
        AllowedIPs = 0.0.0.0/0, ::/0
        PersistentKeepalive = 25

        [http]
        BindAddress = \(httpBind)
        """
    }

    // MARK: - Cloudflare response model

    private struct RegistrationResponse: Decodable {
        let config: ConfigDTO?
        struct ConfigDTO: Decodable {
            let clientId: String?
            let peers: [Peer]?
            let interface: Interface?
            enum CodingKeys: String, CodingKey {
                case clientId = "client_id"
                case peers, interface
            }
        }
        struct Peer: Decodable {
            let publicKey: String?
            let endpoint: Endpoint?
            enum CodingKeys: String, CodingKey {
                case publicKey = "public_key"
                case endpoint
            }
        }
        struct Endpoint: Decodable { let v4: String?; let v6: String?; let host: String? }
        struct Interface: Decodable { let addresses: Addresses? }
        struct Addresses: Decodable { let v4: String?; let v6: String? }
    }

    // MARK: - Keychain

    private static func saveToKeychain(_ config: Config) {
        guard let data = try? JSONEncoder().encode(config) else { return }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount,
        ]
        SecItemDelete(query as CFDictionary)
        var add = query
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(add as CFDictionary, nil)
    }

    private static func loadFromKeychain() -> Config? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data,
              let config = try? JSONDecoder().decode(Config.self, from: data) else { return nil }
        return config
    }

    private static func deleteFromKeychain() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount,
        ]
        SecItemDelete(query as CFDictionary)
    }
}
