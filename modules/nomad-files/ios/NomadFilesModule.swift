// Streaming file work for downloads that are gigabytes long: a sha-256 of a whole file, and
// copying one file into another at an offset (checking sha-1 pieces on the way).
//
// Why not expo-file-system: its File.digest reads 64 KB blocks in one loop with no
// autoreleasepool, so every block stays in memory until the end. Hashing a 2 GB map part held
// 2 GB and iOS killed the app ("jetsam per-process-limit", seen on an iPhone 15 Pro while
// Spain's map was "Preparando"). Copies through FileHandle.readBytes also move every byte
// through JS. Here each block is read inside its own autoreleasepool: memory stays at one block.
import CryptoKit
import ExpoModulesCore
import Foundation

private let BLOCK = 4 * 1024 * 1024

private func fileURL(_ path: String) -> URL {
  if let url = URL(string: path), url.isFileURL { return url }
  return URL(fileURLWithPath: path)
}

private func hex<D: Sequence>(_ digest: D) -> String where D.Element == UInt8 {
  return digest.map { String(format: "%02x", $0) }.joined()
}

/// Reads `handle` in blocks of `size`, each inside an autoreleasepool; `body` returns false to stop.
private func readBlocks(_ handle: FileHandle, size: Int, _ body: (Data) throws -> Bool) throws {
  while true {
    let more: Bool = try autoreleasepool {
      guard let data = try handle.read(upToCount: size), !data.isEmpty else { return false }
      return try body(data)
    }
    if !more { return }
  }
}

public final class NomadFilesModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NomadFiles")

    /// Lowercase hex sha-256 of the whole file.
    AsyncFunction("sha256") { (path: String) -> String in
      let handle = try FileHandle(forReadingFrom: fileURL(path))
      defer { try? handle.close() }
      var hasher = SHA256()
      try readBlocks(handle, size: BLOCK) { data in
        hasher.update(data: data)
        return true
      }
      return hex(hasher.finalize())
    }

    /// Writes all of `src` into `dst` at byte `offset` (`dst` is created when missing and never
    /// truncated). With `sha1s`, `src` is a run of `pieceLength`-byte pieces: each is checked
    /// before it is written, and the copy stops at the first one that doesn't match.
    /// Resolves with the bytes written, or -(index + 1) of the bad piece.
    AsyncFunction("copyInto") { (src: String, dst: String, offset: Double, pieceLength: Double, sha1s: [String]) -> Double in
      let dstURL = fileURL(dst)
      if !FileManager.default.fileExists(atPath: dstURL.path) {
        FileManager.default.createFile(atPath: dstURL.path, contents: nil)
      }
      let input = try FileHandle(forReadingFrom: fileURL(src))
      defer { try? input.close() }
      let output = try FileHandle(forUpdating: dstURL)
      defer { try? output.close() }
      try output.seek(toOffset: UInt64(offset))
      let checked = !sha1s.isEmpty && pieceLength > 0
      var written: Double = 0
      var piece = 0
      var bad = -1
      try readBlocks(input, size: checked ? Int(pieceLength) : BLOCK) { data in
        if checked {
          guard piece < sha1s.count, hex(Insecure.SHA1.hash(data: data)) == sha1s[piece].lowercased() else {
            bad = piece
            return false
          }
          piece += 1
        }
        try output.write(contentsOf: data)
        written += Double(data.count)
        return true
      }
      return bad >= 0 ? Double(-(bad + 1)) : written
    }
  }
}
