import Foundation

/// Process-wide registry of open archives, keyed by the app's item id and shared by the
/// module functions and ZimWebView. There is no UUID index: two installed items can
/// carry the same ZIM UUID (a re-import, or a crafted file), so each reader serves only
/// the archive of its own item id (see ZimWebView.archive(forHost:)).
final class ZimRegistry: @unchecked Sendable {
  static let shared = ZimRegistry()

  private let lock = NSLock()
  private var byId: [String: NZArchive] = [:]

  func open(id: String, path: String) throws -> NZArchive {
    lock.lock()
    if let existing = byId[id], existing.filePath == path {
      lock.unlock()
      return existing
    }
    lock.unlock()

    // Opening reads the header and dirent tables: do it outside the lock.
    let archive = try NZArchive(path: path)

    lock.lock()
    defer { lock.unlock() }
    byId[id] = archive
    return archive
  }

  func close(id: String) {
    lock.lock()
    defer { lock.unlock() }
    byId.removeValue(forKey: id)
  }

  func archive(id: String) -> NZArchive? {
    lock.lock()
    defer { lock.unlock() }
    return byId[id]
  }
}

enum ZimURL {
  static let scheme = "zim"

  /// Characters allowed unescaped in a ZIM path inside a URL.
  private static let pathAllowed: CharacterSet = {
    var set = CharacterSet.urlPathAllowed
    set.remove(charactersIn: "?#%;")
    return set
  }()

  static func url(uuid: String, path: String, fragment: String? = nil) -> URL? {
    let encoded = path.addingPercentEncoding(withAllowedCharacters: pathAllowed) ?? path
    var string = "\(scheme)://\(uuid)/\(encoded)"
    if let fragment, !fragment.isEmpty { string += "#\(fragment)" }
    return URL(string: string)
  }

  /// Decoded ZIM path of a `zim://<uuid>/<path>` URL (no leading slash, query dropped).
  static func path(of url: URL) -> String {
    let encoded = URLComponents(url: url, resolvingAgainstBaseURL: false)?.percentEncodedPath ?? url.path
    let decoded = encoded.removingPercentEncoding ?? encoded
    return decoded.hasPrefix("/") ? String(decoded.dropFirst()) : decoded
  }
}
