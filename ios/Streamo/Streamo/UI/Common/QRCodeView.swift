import SwiftUI
import CoreImage.CIFilterBuiltins
import UIKit

/// Renders the given string as a QR code. CoreImage's QR generator produces a
/// pixel-perfect monochrome image at the symbol's native size; we upscale
/// with nearest-neighbor interpolation so the bars stay crisp.
struct QRCodeView: View {
    let payload: String
    var size: CGFloat = 220

    var body: some View {
        Group {
            if let image = generate() {
                Image(uiImage: image)
                    .interpolation(.none)
                    .resizable()
                    .frame(width: size, height: size)
            } else {
                RoundedRectangle(cornerRadius: 12).fill(.gray.opacity(0.2))
                    .frame(width: size, height: size)
                    .overlay { Image(systemName: "qrcode").foregroundStyle(.secondary) }
            }
        }
        .background(.white, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .padding(8)
    }

    private func generate() -> UIImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(payload.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage else { return nil }
        let scale: CGFloat = max(1, size / output.extent.width)
        let scaled = output.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        let context = CIContext()
        guard let cg = context.createCGImage(scaled, from: scaled.extent) else { return nil }
        return UIImage(cgImage: cg)
    }
}
