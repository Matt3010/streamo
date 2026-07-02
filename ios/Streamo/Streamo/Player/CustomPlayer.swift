import SwiftUI
import AVKit
import AVFoundation
import UIKit

/// Hosts the AVPlayer's video through an `AVPlayerLayer` and wires
/// Picture-in-Picture to that layer. AVPlayerViewController used to give us PiP
/// for free; with custom controls we own it. PiP state is surfaced via `pip`
/// so the overlay button can reflect availability / active state.
struct PlayerLayerView: UIViewRepresentable {
    let player: AVPlayer
    let pip: PiPProxy

    func makeUIView(context: Context) -> PlayerHostView {
        let view = PlayerHostView()
        view.playerLayer.player = player
        view.playerLayer.videoGravity = .resizeAspect
        context.coordinator.setup(layer: view.playerLayer)
        return view
    }

    func updateUIView(_ uiView: PlayerHostView, context: Context) {
        if uiView.playerLayer.player !== player {
            uiView.playerLayer.player = player
            context.coordinator.setup(layer: uiView.playerLayer)
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator(pip: pip) }

    /// A UIView backed directly by an AVPlayerLayer.
    final class PlayerHostView: UIView {
        override class var layerClass: AnyClass { AVPlayerLayer.self }
        var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
    }

    final class Coordinator: NSObject, AVPictureInPictureControllerDelegate {
        private let pip: PiPProxy
        private var controller: AVPictureInPictureController?
        private var possibleObs: NSKeyValueObservation?
        private var activeObs: NSKeyValueObservation?

        init(pip: PiPProxy) { self.pip = pip }

        @MainActor
        func setup(layer: AVPlayerLayer) {
            guard AVPictureInPictureController.isPictureInPictureSupported() else { return }
            // Rebuild against the (new) layer.
            possibleObs = nil
            activeObs = nil
            let controller = AVPictureInPictureController(playerLayer: layer)
            controller?.canStartPictureInPictureAutomaticallyFromInline = true
            controller?.delegate = self
            self.controller = controller
            possibleObs = controller?.observe(\.isPictureInPicturePossible, options: [.initial, .new]) { [pip] _, change in
                let value = change.newValue ?? false
                Task { @MainActor in pip.isPossible = value }
            }
            activeObs = controller?.observe(\.isPictureInPictureActive, options: [.initial, .new]) { [pip] _, change in
                let value = change.newValue ?? false
                Task { @MainActor in pip.isActive = value }
            }
            pip.toggle = { [weak controller] in
                guard let controller else { return }
                if controller.isPictureInPictureActive { controller.stopPictureInPicture() }
                else { controller.startPictureInPicture() }
            }
        }
    }
}

/// Bridges PiP state/actions from the AVPlayerLayer coordinator up to SwiftUI.
@MainActor
@Observable
final class PiPProxy {
    var isPossible = false
    var isActive = false
    var toggle: () -> Void = {}
}

/// Native AirPlay route picker — keeps casting working without
/// AVPlayerViewController.
struct AirPlayRoutePicker: UIViewRepresentable {
    func makeUIView(context: Context) -> AVRoutePickerView {
        let view = AVRoutePickerView()
        view.tintColor = .white
        view.activeTintColor = .white
        view.prioritizesVideoDevices = true
        return view
    }

    func updateUIView(_ uiView: AVRoutePickerView, context: Context) {}
}
