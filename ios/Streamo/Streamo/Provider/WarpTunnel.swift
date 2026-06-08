import Foundation
import Network

/// Userspace WireGuard egress for the provider traffic. Brings up an in-process
/// WireGuard tunnel to Cloudflare WARP (via `WireProxyKit`, a gomobile build of
/// wireproxy/wiresocks) that exposes a local HTTP-CONNECT proxy on loopback.
/// `warpSession` is a `URLSession` whose every request is routed through that
/// proxy, so it egresses from a Cloudflare IP — hiding the device IP from
/// StreamingCommunity / vixcloud without a system VPN or a remote server.
///
/// Only the provider/scrape requests and `LocalHLSServer`'s upstream fetches
/// use `warpSession`; the rest of the device is untouched.
actor WarpTunnel {
    static let shared = WarpTunnel()

    /// Engine that owns the actual WireGuard userspace + local proxy. Injected
    /// so the tunnel compiles (and degrades gracefully) before the gomobile
    /// `WireProxyKit` xcframework is added to the project.
    private let engine: WarpProxyEngine
    private let proxyHost = "127.0.0.1"
    private var proxyPort: UInt16 = 0
    private var running = false
    private var cachedSession: URLSession?

    init(engine: WarpProxyEngine = DefaultWarpProxyEngine.make()) {
        self.engine = engine
    }

    var isReady: Bool { running && proxyPort != 0 }

    /// Whether the egress engine is actually available in this build (the
    /// gomobile module is linked). When false, WARP mode can't be turned on.
    var isAvailable: Bool { engine.isAvailable }

    /// Start the tunnel from the registered WARP account. Idempotent.
    ///
    /// After the engine boots we POLL the egress until the local proxy is bound
    /// and the WireGuard handshake has completed (a freshly-registered key also
    /// needs a moment to activate on Cloudflare's side) — only then do we report
    /// ready. Without this, an immediate `trace()`/playback right after
    /// registering races the warm-up and fails until the app is relaunched.
    @discardableResult
    func start() async throws -> Bool {
        if isReady { return true }
        let port = Self.randomLoopbackPort()
        let bind = "\(proxyHost):\(port)"
        guard let confText = await WarpAccount.shared.wireproxyConfig(httpBind: bind) else {
            throw TunnelError.notRegistered
        }
        try engine.start(config: confText)
        proxyPort = port
        cachedSession = nil

        // Probe the proxy until it egresses (up to ~10s), then mark ready.
        let probeSession = Self.makeProxiedSession(host: proxyHost, port: port)
        for attempt in 0..<20 {
            if attempt > 0 { try? await Task.sleep(nanoseconds: 500_000_000) }
            if await Self.probeEgress(probeSession) {
                running = true
                cachedSession = probeSession
                return true
            }
        }
        engine.stop()
        proxyPort = 0
        throw TunnelError.notReady
    }

    /// One egress probe: any 2xx through the proxy means the tunnel is up.
    private static func probeEgress(_ session: URLSession) async -> Bool {
        var request = URLRequest(url: URL(string: "https://www.cloudflare.com/cdn-cgi/trace")!)
        request.timeoutInterval = 4
        request.cachePolicy = .reloadIgnoringLocalCacheData
        guard let (_, response) = try? await session.data(for: request),
              let http = response as? HTTPURLResponse else { return false }
        return (200...299).contains(http.statusCode)
    }

    func stop() {
        engine.stop()
        running = false
        proxyPort = 0
        cachedSession = nil
    }

    /// A `URLSession` that routes every request through the WARP proxy. Returns
    /// `.shared` (direct) when the tunnel isn't ready, so callers can always ask
    /// for it and rely on `isReady` to know whether traffic is actually hidden.
    func warpSession() -> URLSession {
        guard isReady else { return .shared }
        if let s = cachedSession { return s }
        let session = Self.makeProxiedSession(host: proxyHost, port: proxyPort)
        cachedSession = session
        return session
    }

    /// Verify the egress: fetch Cloudflare's trace through `warpSession` and
    /// parse `warp=on` + the egress IP. Used by the Settings status panel.
    func trace() async -> TraceResult? {
        guard isReady else { return nil }
        var request = URLRequest(url: URL(string: "https://www.cloudflare.com/cdn-cgi/trace")!)
        request.timeoutInterval = 8
        guard let (data, response) = try? await warpSession().data(for: request),
              let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            return nil
        }
        let fields = String(decoding: data, as: UTF8.self)
            .split(separator: "\n")
            .reduce(into: [String: String]()) { acc, line in
                let parts = line.split(separator: "=", maxSplits: 1)
                if parts.count == 2 { acc[String(parts[0])] = String(parts[1]) }
            }
        return TraceResult(warp: fields["warp"] == "on", ip: fields["ip"], colo: fields["colo"])
    }

    struct TraceResult: Sendable {
        let warp: Bool
        let ip: String?
        let colo: String?
    }

    enum TunnelError: Error, LocalizedError {
        case notRegistered
        case engineUnavailable
        case notReady
        var errorDescription: String? {
            switch self {
            case .notRegistered: return "Account WARP non registrato."
            case .engineUnavailable: return "Motore WARP non disponibile in questa build."
            case .notReady: return "Tunnel WARP non pronto (handshake non completato). Riprova tra qualche secondo."
            }
        }
    }

    // MARK: - Proxy wiring

    /// A `URLSession` whose every request goes through the local HTTP-CONNECT
    /// proxy (handles http + https-via-CONNECT). Min deployment is iOS 17, so
    /// the modern `ProxyConfiguration` is always available.
    private static func makeProxiedSession(host: String, port: UInt16) -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        if let nwPort = NWEndpoint.Port(rawValue: port) {
            let endpoint = NWEndpoint.hostPort(host: .init(host), port: nwPort)
            config.proxyConfigurations = [ProxyConfiguration(httpCONNECTProxy: endpoint)]
        }
        return URLSession(configuration: config)
    }

    /// Ephemeral loopback port for the proxy bind. Range chosen to avoid the
    /// LocalHLSServer's fixed 50321.
    private static func randomLoopbackPort() -> UInt16 {
        UInt16.random(in: 51000...58000)
    }
}

// MARK: - Engine abstraction

/// The thing that owns the WireGuard userspace stack + local proxy. One real
/// implementation (gomobile `WireProxyKit`) and one stub so the app links
/// before the binary is integrated.
protocol WarpProxyEngine: Sendable {
    var isAvailable: Bool { get }
    /// Bring up WireGuard and start the local proxy described by the config's
    /// `[http] BindAddress`. Must return promptly (run the tunnel on its own
    /// thread/goroutine), not block.
    func start(config: String) throws
    func stop()
}

/// Selects the real engine when `WireProxyKit` is linked, else the stub.
enum DefaultWarpProxyEngine {
    static func make() -> WarpProxyEngine {
        #if canImport(WireProxyKit)
        return WireProxyEngine()
        #else
        return UnavailableWarpProxyEngine()
        #endif
    }
}

/// Fallback when the gomobile module isn't present — WARP mode stays off.
struct UnavailableWarpProxyEngine: WarpProxyEngine {
    var isAvailable: Bool { false }
    func start(config: String) throws { throw WarpTunnel.TunnelError.engineUnavailable }
    func stop() {}
}

#if canImport(WireProxyKit)
import WireProxyKit

/// Real engine backed by the gomobile build of `ios/wireproxykit` (wraps
/// whyvl/wireproxy). gomobile names symbols `<Package><Func>`, so the Go
/// package `wireproxykit` exporting `Start(string) error` / `Stop()` becomes
/// `WireproxykitStart(_:)` (throws — Go's trailing `error` bridges to Swift
/// `throws`) and `WireproxykitStop()`. The module name is the `-o` xcframework
/// name (`WireProxyKit`). If you rename the Go package, update these calls.
struct WireProxyEngine: WarpProxyEngine {
    var isAvailable: Bool { true }
    func start(config: String) throws {
        // gomobile exposes the Go `error` return as a free function with a
        // trailing NSError** (no automatic Swift `throws` bridging for free
        // functions), so pass the pointer explicitly.
        var err: NSError?
        WireproxykitStart(config, &err)
        if let err { throw err }
    }
    func stop() { WireproxykitStop() }
}
#endif
