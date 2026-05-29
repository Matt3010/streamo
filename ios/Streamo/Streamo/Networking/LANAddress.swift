import Foundation
import Darwin

/// Resolves the device's shareable IPv4 address for LAN playback. We prefer
/// private IPv4s on interfaces that can actually be reached by nearby peers
/// (Wi-Fi, bridge / hotspot, peer-to-peer) and ignore loopback / cellular
/// point-to-point links that LAN clients cannot dial directly.
enum LANAddress {
    struct Candidate: Identifiable, Sendable {
        let interfaceName: String
        let address: String

        var id: String { "\(interfaceName)-\(address)" }

        var interfaceLabel: String {
            switch interfaceName {
            case "en0":
                return "Wi-Fi"
            case "bridge100", "ap1":
                return "Hotspot personale"
            case "en1", "awdl0":
                return "Peer-to-peer"
            default:
                return interfaceName
            }
        }
    }

    static func currentWiFiIPv4() -> String? {
        currentShareableIPv4()
    }

    static func currentShareableIPv4() -> String? {
        shareableIPv4Candidates().first?.address
    }

    static func shareableIPv4Candidates() -> [Candidate] {
        var ifaddrPtr: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&ifaddrPtr) == 0, let first = ifaddrPtr else { return [] }
        defer { freeifaddrs(ifaddrPtr) }

        var candidates: [Candidate] = []
        var cursor: UnsafeMutablePointer<ifaddrs>? = first
        while let ptr = cursor {
            let ifa = ptr.pointee
            cursor = ifa.ifa_next

            let name = String(cString: ifa.ifa_name)
            guard let addr = ifa.ifa_addr, addr.pointee.sa_family == UInt8(AF_INET) else { continue }

            let flags = Int32(ifa.ifa_flags)
            // Skip interfaces that are down, loopback, or cellular / tunnel-like
            // point-to-point links (`pdp_ip*`, `utun*`, ...).
            guard (flags & IFF_UP) != 0,
                  (flags & IFF_LOOPBACK) == 0,
                  (flags & IFF_POINTOPOINT) == 0 else { continue }

            var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            if getnameinfo(addr, socklen_t(addr.pointee.sa_len),
                           &host, socklen_t(host.count), nil, 0, NI_NUMERICHOST) == 0 {
                let ip = String(cString: host)
                guard isShareableIPv4(ip) else { continue }
                candidates.append(Candidate(interfaceName: name, address: ip))
            }
        }

        return candidates.sorted { lhs, rhs in
            let l = score(lhs)
            let r = score(rhs)
            if l != r { return l > r }
            if lhs.interfaceLabel != rhs.interfaceLabel {
                return lhs.interfaceLabel.localizedCaseInsensitiveCompare(rhs.interfaceLabel) == .orderedAscending
            }
            return lhs.address < rhs.address
        }
    }

    private static func score(_ candidate: Candidate) -> Int {
        var value = 0
        if isPrivateIPv4(candidate.address) { value += 100 }
        if isLinkLocalIPv4(candidate.address) { value += 10 }

        switch candidate.interfaceName {
        case "bridge100", "ap1":
            value += 40
        case "en0":
            value += 30
        case "en1", "awdl0":
            value += 20
        default:
            break
        }
        return value
    }

    private static func isShareableIPv4(_ ip: String) -> Bool {
        isPrivateIPv4(ip) || isLinkLocalIPv4(ip)
    }

    private static func isPrivateIPv4(_ ip: String) -> Bool {
        let octets = ip.split(separator: ".").compactMap { Int($0) }
        guard octets.count == 4 else { return false }

        switch (octets[0], octets[1]) {
        case (10, _):
            return true
        case (172, 16...31):
            return true
        case (192, 168):
            return true
        default:
            return false
        }
    }

    private static func isLinkLocalIPv4(_ ip: String) -> Bool {
        let octets = ip.split(separator: ".").compactMap { Int($0) }
        guard octets.count == 4 else { return false }
        return octets[0] == 169 && octets[1] == 254
    }
}
