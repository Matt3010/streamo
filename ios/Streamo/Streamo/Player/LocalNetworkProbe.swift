import Foundation
import Network

/// Best-effort detection of a DENIED "Local Network" permission. iOS exposes
/// no API for the permission state, but browsing for a Bonjour service makes
/// `NWBrowser` report a `PolicyDenied` DNS error when access is refused. We
/// only treat that explicit signal as "denied" — a timeout is left as "not
/// denied" so a network that simply blocks mDNS never produces a false alarm.
enum LocalNetworkProbe {
    /// kDNSServiceErr_PolicyDenied — surfaced when local network access is off.
    private static let policyDenied: DNSServiceErrorType = -65570

    /// One-shot guard shared by the browser callback and the timeout, both of
    /// which run concurrently.
    private final class Resolver: @unchecked Sendable {
        private let lock = NSLock()
        private var finished = false
        var browser: NWBrowser?
        let cont: CheckedContinuation<Bool, Never>

        init(_ cont: CheckedContinuation<Bool, Never>) { self.cont = cont }

        func finish(_ denied: Bool) {
            lock.lock(); defer { lock.unlock() }
            guard !finished else { return }
            finished = true
            browser?.cancel()
            cont.resume(returning: denied)
        }
    }

    /// Returns true only when we get an explicit policy-denied signal.
    static func isDenied(timeout: TimeInterval = 2.5) async -> Bool {
        await withCheckedContinuation { (cont: CheckedContinuation<Bool, Never>) in
            let resolver = Resolver(cont)
            let browser = NWBrowser(for: .bonjour(type: "_http._tcp", domain: nil), using: NWParameters())
            resolver.browser = browser
            browser.stateUpdateHandler = { state in
                if case .waiting(let error) = state,
                   case .dns(let code) = error, code == policyDenied {
                    resolver.finish(true)
                }
            }
            browser.start(queue: .global(qos: .utility))
            DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + timeout) {
                resolver.finish(false)
            }
        }
    }
}
