import Foundation
import Darwin

/// Reads the device's IPv4 address on the Wi-Fi interface so we can advertise
/// a shareable URL to peers on the same LAN. We pick `en0` (Wi-Fi on a
/// physical device) and fall back to `pen0` / `bridge100` (Personal Hotspot or
/// peer-to-peer fallbacks) before giving up. Returns nil when no LAN
/// interface is up — typically because the user is on cellular only.
enum LANAddress {
    static func currentWiFiIPv4() -> String? {
        var address: String?
        var ifaddrPtr: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&ifaddrPtr) == 0, let first = ifaddrPtr else { return nil }
        defer { freeifaddrs(ifaddrPtr) }

        // Prefer Wi-Fi (`en0`), then Personal Hotspot or Wi-Fi peer-to-peer.
        let preferred: [String] = ["en0", "pen0", "bridge100", "en1"]
        var found: [String: String] = [:]

        var cursor: UnsafeMutablePointer<ifaddrs>? = first
        while let ptr = cursor {
            let ifa = ptr.pointee
            cursor = ifa.ifa_next

            let name = String(cString: ifa.ifa_name)
            guard let addr = ifa.ifa_addr, addr.pointee.sa_family == UInt8(AF_INET) else { continue }
            // Skip interfaces that are down.
            let flags = Int32(ifa.ifa_flags)
            guard (flags & IFF_UP) != 0, (flags & IFF_LOOPBACK) == 0 else { continue }

            var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            if getnameinfo(addr, socklen_t(ifa.ifa_addr.pointee.sa_len),
                           &host, socklen_t(host.count), nil, 0, NI_NUMERICHOST) == 0 {
                found[name] = String(cString: host)
            }
        }

        for name in preferred {
            if let ip = found[name] { address = ip; break }
        }
        return address ?? found.values.first
    }
}
