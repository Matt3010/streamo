import UIKit
import AVFoundation

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        // Prime the audio session category at launch so the system treats this
        // as a playback app from the start — a prerequisite for Picture-in-
        // Picture to be eligible the instant playback begins (the session is
        // only *activated* when a player actually starts, so this doesn't grab
        // audio or interrupt the user's music on launch).
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback, options: [])
        return true
    }

    func application(_ application: UIApplication, supportedInterfaceOrientationsFor window: UIWindow?) -> UIInterfaceOrientationMask {
        OrientationLock.supportedOrientations
    }
}

enum OrientationLock {
    static var supportedOrientations: UIInterfaceOrientationMask = .portrait

    @MainActor
    static func lockPortrait() {
        supportedOrientations = .portrait
        updateGeometry(.portrait)
    }

    @MainActor
    static func unlockForPlayer() {
        supportedOrientations = .allButUpsideDown
        updateGeometry(.allButUpsideDown)
    }

    @MainActor
    private static func updateGeometry(_ orientations: UIInterfaceOrientationMask) {
        for scene in UIApplication.shared.connectedScenes {
            guard let windowScene = scene as? UIWindowScene else { continue }
            windowScene.requestGeometryUpdate(.iOS(interfaceOrientations: orientations))
            windowScene.windows.forEach { window in
                window.rootViewController?.setNeedsUpdateOfSupportedInterfaceOrientations()
            }
        }
    }
}
