import AppKit
import UniformTypeIdentifiers

let expectedArgumentCount = 2
guard CommandLine.arguments.count == expectedArgumentCount else {
  fputs("Usage: verify-macos-document-icon.swift <type-identifier>\n", stderr)
  exit(1)
}

let typeIdentifier = CommandLine.arguments[1]
guard let documentType = UTType(typeIdentifier) else {
  fputs("Could not resolve document type: \(typeIdentifier)\n", stderr)
  exit(1)
}

let icon = NSWorkspace.shared.icon(for: documentType)
icon.size = NSSize(width: 512, height: 512)
var proposedRect = NSRect(origin: .zero, size: icon.size)
guard let image = icon.cgImage(forProposedRect: &proposedRect, context: nil, hints: nil) else {
  fputs("Could not render document icon for \(typeIdentifier)\n", stderr)
  exit(1)
}

let bitmap = NSBitmapImageRep(cgImage: image)
let sampleStride = max(bitmap.pixelsWide / 256, 1)
var blueSampleCount = 0

for y in stride(from: 0, to: bitmap.pixelsHigh, by: sampleStride) {
  for x in stride(from: 0, to: bitmap.pixelsWide, by: sampleStride) {
    guard let color = bitmap.colorAt(x: x, y: y)?.usingColorSpace(.sRGB) else { continue }

    if color.alphaComponent > 0.2,
      color.blueComponent - color.redComponent > 0.15,
      color.blueComponent - color.greenComponent > 0.05
    {
      blueSampleCount += 1
    }
  }
}

if blueSampleCount < 100 {
  fputs("Rendered document icon does not contain the blue Shift badge\n", stderr)
  exit(1)
}

print("Rendered blue Shift document badge for \(typeIdentifier)")
