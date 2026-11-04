// The text on a screenshot, for scripts/carplay/e2e-carplay.sh: the car screen has no accessibility tree
// Maestro or axe can read, so its checks read the pixels with Vision. One line per text found:
// "<centre x> <centre y><TAB><text>", in the image's pixels from its top left.
// Usage: ocr <image.png>
import AppKit
import Vision

let url = URL(fileURLWithPath: CommandLine.arguments[1])
guard let image = NSImage(contentsOf: url), let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
  FileHandle.standardError.write("ocr: can't read \(url.path)\n".data(using: .utf8)!)
  exit(1)
}
let width = Double(cg.width), height = Double(cg.height)
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.recognitionLanguages = ["es-ES", "en-US"]
request.usesLanguageCorrection = false
try VNImageRequestHandler(cgImage: cg).perform([request])
for observation in request.results ?? [] {
  guard let text = observation.topCandidates(1).first?.string else { continue }
  let box = observation.boundingBox  // normalised, origin at the bottom left
  let x = Int((box.midX * width).rounded()), y = Int(((1 - box.midY) * height).rounded())
  print("\(x) \(y)\t\(text)")
}
