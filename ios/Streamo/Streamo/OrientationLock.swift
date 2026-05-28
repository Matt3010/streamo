import UIKit

final class AppDelegate: NSObject, UIApplicationDelegate {
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
