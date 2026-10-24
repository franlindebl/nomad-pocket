import Foundation

/// Process-wide registry of open archives, shared by the module functions and the
/// `zim://` scheme handler. Archives are keyed by the app's item id and by UUID
/// (the URL host used by ZimWebView).
final class ZimRegistry: @unchecked Sendable {
  static let shared = ZimRegistry()

  private let lock = NSLock()
  private var byId: [String: NZArchive] = [:]
  private var byUuid: [String: NZArchive] = [:]

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
    if let old = byId[id] { removeUuid(of: old) }
    byId[id] = archive
    // Metadata probes (registerZimFile) must not take over the UUID the reader uses.
    if !id.hasPrefix(Self.probePrefix) { byUuid[archive.uuid] = archive }
    return archive
  }

  func close(id: String) {
    lock.lock()
    defer { lock.unlock() }
    if let old = byId.removeValue(forKey: id) { removeUuid(of: old) }
  }

  static let probePrefix = "__probe_"

  /// Caller holds the lock. Only drops the UUID entry if it still points at `archive`.
  private func removeUuid(of archive: NZArchive) {
    if byUuid[archive.uuid] === archive { byUuid.removeValue(forKey: archive.uuid) }
  }

  func archive(id: String) -> NZArchive? {
    lock.lock()
    defer { lock.unlock() }
    return byId[id]
  }

  func archive(uuid: String) -> NZArchive? {
    lock.lock()
    defer { lock.unlock() }
    return byUuid[uuid.lowercased()]
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
