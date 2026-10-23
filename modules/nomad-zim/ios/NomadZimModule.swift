import ExpoModulesCore
import Foundation

final class ArchiveNotOpenException: GenericException<String>, @unchecked Sendable {
  override var reason: String { "ZIM archive '\(param)' is not open" }
}

final class OpenFailedException: GenericException<String>, @unchecked Sendable {
  override var reason: String { param }
}

/// Concurrent queue for libzim work: never the JS thread, never the main thread,
/// and not Expo's shared serial async-function queue (a slow full-text search must
/// not block other modules).
let zimWorkQueue = DispatchQueue(label: "nomad.zim.work", qos: .userInitiated, attributes: .concurrent)

public final class NomadZimModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NomadZim")

    AsyncFunction("openArchive") { (id: String, path: String) -> [String: Any?] in
      do {
        let archive = try ZimRegistry.shared.open(id: id, path: path)
        return Self.info(archive)
      } catch {
        throw OpenFailedException(error.localizedDescription)
      }
    }.runOnQueue(zimWorkQueue)

    Function("closeArchive") { (id: String) in
      ZimRegistry.shared.close(id: id)
    }

    Function("isOpen") { (id: String) -> Bool in
      ZimRegistry.shared.archive(id: id) != nil
    }

    AsyncFunction("suggest") { (id: String, query: String, limit: Int) -> [[String: Any?]] in
      let archive = try Self.archive(id)
      return archive.suggest(query, limit: limit).map(Self.hit)
    }.runOnQueue(zimWorkQueue)

    AsyncFunction("search") { (id: String, query: String, limit: Int) -> [[String: Any?]] in
      let archive = try Self.archive(id)
      return archive.search(query, limit: limit).map(Self.hit)
    }.runOnQueue(zimWorkQueue)

    AsyncFunction("getEntry") { (id: String, path: String) -> [String: Any?]? in
      let archive = try Self.archive(id)
      guard let info = archive.entryInfo(atPath: path) else { return nil }
      return ["path": info.path, "title": info.title, "mimeType": info.mimeType, "size": Double(info.size), "redirect": info.wasRedirect]
    }.runOnQueue(zimWorkQueue)

    /// Text content (HTML, CSS, JSON…) of an entry, redirects resolved.
    AsyncFunction("getContent") { (id: String, path: String) -> [String: Any?]? in
      let archive = try Self.archive(id)
      guard let info = archive.entryInfo(atPath: path), let data = archive.data(atPath: info.path) else { return nil }
      let text = String(data: data, encoding: .utf8) ?? String(decoding: data, as: UTF8.self)
      return ["path": info.path, "title": info.title, "mimeType": info.mimeType, "content": text]
    }.runOnQueue(zimWorkQueue)

    AsyncFunction("getMainPath") { (id: String) -> String? in
      try Self.archive(id).mainPath
    }.runOnQueue(zimWorkQueue)

    AsyncFunction("randomPath") { (id: String) -> String? in
      let archive = try Self.archive(id)
      // getRandomEntry may land on a non-HTML item in some archives: retry a few times.
      for _ in 0..<8 {
        if let path = archive.randomPath(), let info = archive.entryInfo(atPath: path), info.mimeType.hasPrefix("text/html") {
          return info.path
        }
      }
      return archive.randomPath()
    }.runOnQueue(zimWorkQueue)

    /// Marks a file or directory as excluded from iCloud/iTunes backup.
    AsyncFunction("excludeFromBackup") { (path: String) -> Bool in
      var url = URL(fileURLWithPath: Self.plainPath(path))
      guard FileManager.default.fileExists(atPath: url.path) else { return false }
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      try url.setResourceValues(values)
      return true
    }.runOnQueue(zimWorkQueue)

    View(ZimWebView.self) {
      Events("onNavigationChange", "onLoadEnd")

      Prop("archiveId") { (view: ZimWebView, id: String?) in
        view.archiveId = id
      }
      Prop("path") { (view: ZimWebView, path: String?) in
        view.requestedPath = path
      }
      Prop("darkMode") { (view: ZimWebView, on: Bool?) in
        view.setDarkMode(on ?? false)
      }
      Prop("textZoom") { (view: ZimWebView, percent: Double?) in
        view.setTextZoom(Int(percent ?? 100))
      }

      OnViewDidUpdateProps { (view: ZimWebView) in
        view.loadRequestedIfNeeded()
      }

      AsyncFunction("goBack") { (view: ZimWebView) in
        if view.webView.canGoBack { view.webView.goBack() }
      }.runOnQueue(.main)
      AsyncFunction("goForward") { (view: ZimWebView) in
        if view.webView.canGoForward { view.webView.goForward() }
      }.runOnQueue(.main)
      AsyncFunction("reload") { (view: ZimWebView) in
        view.webView.reload()
      }.runOnQueue(.main)
      AsyncFunction("loadPath") { (view: ZimWebView, path: String) in
        view.load(path: path)
      }.runOnQueue(.main)
      AsyncFunction("setTextZoom") { (view: ZimWebView, percent: Double) in
        view.setTextZoom(Int(percent))
      }.runOnQueue(.main)
      AsyncFunction("setDarkMode") { (view: ZimWebView, on: Bool) in
        view.setDarkMode(on)
      }.runOnQueue(.main)
      AsyncFunction("findInPage") { (view: ZimWebView, text: String, backwards: Bool?, promise: Promise) in
        view.find(text, backwards: backwards ?? false) { result in promise.resolve(result) }
      }.runOnQueue(.main)
      AsyncFunction("clearFind") { (view: ZimWebView) in
        view.clearFind()
      }.runOnQueue(.main)
    }
  }

  private static func archive(_ id: String) throws -> NZArchive {
    guard let archive = ZimRegistry.shared.archive(id: id) else { throw ArchiveNotOpenException(id) }
    return archive
  }

  static func plainPath(_ uri: String) -> String {
    if uri.hasPrefix("file://"), let url = URL(string: uri) { return url.path }
    return uri
  }

  private static func hit(_ h: NZSearchHit) -> [String: Any?] {
    var out: [String: Any?] = ["path": h.path, "title": h.title]
    if let snippet = h.snippet { out["snippet"] = snippet }
    if h.wordCount >= 0 { out["wordCount"] = h.wordCount }
    return out
  }

  private static func info(_ a: NZArchive) -> [String: Any?] {
    var illustration: String? = nil
    if let png = a.illustrationPNG(withSize: 48) {
      illustration = "data:image/png;base64,\(png.base64EncodedString())"
    }
    return [
      "uuid": a.uuid,
      "title": a.metadata("Title") ?? "",
      "description": a.metadata("Description") ?? "",
      "language": a.metadata("Language") ?? "",
      "creator": a.metadata("Creator") ?? "",
      "publisher": a.metadata("Publisher") ?? "",
      "date": a.metadata("Date") ?? "",
      "name": a.metadata("Name") ?? "",
      "articleCount": Int(a.articleCount),
      "mediaCount": Int(a.mediaCount),
      "mainPath": a.mainPath,
      "hasFulltextIndex": a.hasFulltextIndex,
      "hasTitleIndex": a.hasTitleIndex,
      "illustration": illustration,
    ]
  }
}
