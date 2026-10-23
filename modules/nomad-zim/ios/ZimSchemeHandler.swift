import Foundation
import WebKit

/// Serves `zim://<uuid>/<path>` from open archives.
///
/// - Redirect entries are resolved and served directly (WKURLSchemeHandler cannot
///   emit 3xx). Main-frame redirects are turned into real navigations by
///   ZimWebView's navigation delegate so relative links keep working.
/// - Honors `Range: bytes=a-b` (206) for audio/video, which WebKit's media stack
///   always uses, and streams large bodies in chunks instead of loading them whole.
final class ZimSchemeHandler: NSObject, WKURLSchemeHandler {
  /// Upper bound of a single 206 response; players request the rest as needed.
  private static let maxRangeChunk: UInt64 = 4 * 1024 * 1024
  /// Bodies above this are streamed in chunks.
  private static let streamChunk: UInt64 = 2 * 1024 * 1024

  // Accessed on the main thread only.
  private var active = Set<ObjectIdentifier>()

  func webView(_ webView: WKWebView, start urlSchemeTask: any WKURLSchemeTask) {
    let key = ObjectIdentifier(urlSchemeTask)
    active.insert(key)
    let request = urlSchemeTask.request
    guard let url = request.url, let host = url.host, let archive = ZimRegistry.shared.archive(uuid: host) else {
      respondStatus(urlSchemeTask, key: key, status: 404)
      return
    }
    let path = ZimURL.path(of: url)
    let rangeHeader = request.value(forHTTPHeaderField: "Range")

    zimWorkQueue.async { [weak self] in
      guard let self else { return }
      guard let info = archive.entryInfo(atPath: path) else {
        self.onMain(key) { self.respondStatus(urlSchemeTask, key: key, status: 404) }
        return
      }
      let mime = Self.normalizedMime(info.mimeType, path: info.path)
      let size = info.size
      var headers: [String: String] = [
        "Content-Type": Self.contentType(mime),
        "Accept-Ranges": "bytes",
        "Cache-Control": "max-age=86400",
      ]

      if let range = Self.parseRange(rangeHeader, size: size) {
        let length = min(range.upperBound - range.lowerBound + 1, Self.maxRangeChunk)
        guard let data = archive.data(atPath: info.path, offset: range.lowerBound, length: length) else {
          self.onMain(key) { self.respondStatus(urlSchemeTask, key: key, status: 500) }
          return
        }
        let end = range.lowerBound + UInt64(data.count) - 1
        headers["Content-Length"] = String(data.count)
        headers["Content-Range"] = "bytes \(range.lowerBound)-\(end)/\(size)"
        let response = HTTPURLResponse(url: url, statusCode: 206, httpVersion: "HTTP/1.1", headerFields: headers)!
        self.onMain(key) {
          urlSchemeTask.didReceive(response)
          urlSchemeTask.didReceive(data)
          self.finish(urlSchemeTask, key: key)
        }
        return
      }
      if rangeHeader != nil, size > 0 {
        // Unsatisfiable range.
        headers["Content-Range"] = "bytes */\(size)"
        let response = HTTPURLResponse(url: url, statusCode: 416, httpVersion: "HTTP/1.1", headerFields: headers)!
        self.onMain(key) {
          urlSchemeTask.didReceive(response)
          self.finish(urlSchemeTask, key: key)
        }
        return
      }

      headers["Content-Length"] = String(size)
      let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!
      if size <= Self.streamChunk {
        guard let data = archive.data(atPath: info.path) else {
          self.onMain(key) { self.respondStatus(urlSchemeTask, key: key, status: 500) }
          return
        }
        self.onMain(key) {
          urlSchemeTask.didReceive(response)
          urlSchemeTask.didReceive(data)
          self.finish(urlSchemeTask, key: key)
        }
        return
      }
      // Large body without Range: stream it.
      self.onMain(key) { urlSchemeTask.didReceive(response) }
      var offset: UInt64 = 0
      while offset < size {
        guard self.isActive(key) else { return }
        guard let chunk = archive.data(atPath: info.path, offset: offset, length: Self.streamChunk), !chunk.isEmpty else { break }
        offset += UInt64(chunk.count)
        self.onMain(key) { urlSchemeTask.didReceive(chunk) }
      }
      self.onMain(key) { self.finish(urlSchemeTask, key: key) }
    }
  }

  func webView(_ webView: WKWebView, stop urlSchemeTask: any WKURLSchemeTask) {
    active.remove(ObjectIdentifier(urlSchemeTask))
  }

  // MARK: - Helpers

  private func isActive(_ key: ObjectIdentifier) -> Bool {
    DispatchQueue.main.sync { active.contains(key) }
  }

  /// Runs `block` on the main thread only if the task was not stopped meanwhile
  /// (calling a stopped task raises an Objective-C exception).
  private func onMain(_ key: ObjectIdentifier, _ block: @escaping () -> Void) {
    DispatchQueue.main.async { [weak self] in
      guard let self, self.active.contains(key) else { return }
      block()
    }
  }

  private func finish(_ task: any WKURLSchemeTask, key: ObjectIdentifier) {
    guard active.contains(key) else { return }
    active.remove(key)
    task.didFinish()
  }

  private func respondStatus(_ task: any WKURLSchemeTask, key: ObjectIdentifier, status: Int) {
    guard active.contains(key), let url = task.request.url else { return }
    let body = Data("Not found".utf8)
    let response = HTTPURLResponse(
      url: url, statusCode: status, httpVersion: "HTTP/1.1",
      headerFields: ["Content-Type": "text/plain; charset=utf-8", "Content-Length": String(body.count)]
    )!
    task.didReceive(response)
    task.didReceive(body)
    finish(task, key: key)
  }

  static func parseRange(_ header: String?, size: UInt64) -> ClosedRange<UInt64>? {
    guard let header, size > 0, header.hasPrefix("bytes=") else { return nil }
    let spec = header.dropFirst("bytes=".count).split(separator: ",").first.map(String.init) ?? ""
    let parts = spec.split(separator: "-", omittingEmptySubsequences: false).map { $0.trimmingCharacters(in: .whitespaces) }
    guard parts.count == 2 else { return nil }
    if parts[0].isEmpty {
      // Suffix range: last N bytes.
      guard let n = UInt64(parts[1]), n > 0 else { return nil }
      let start = size > n ? size - n : 0
      return start...(size - 1)
    }
    guard let start = UInt64(parts[0]), start < size else { return nil }
    let end = parts[1].isEmpty ? size - 1 : min(UInt64(parts[1]) ?? (size - 1), size - 1)
    guard end >= start else { return nil }
    return start...end
  }

  static func normalizedMime(_ raw: String, path: String) -> String {
    var mime = raw.split(separator: ";").first.map { $0.trimmingCharacters(in: .whitespaces).lowercased() } ?? ""
    if mime.isEmpty || mime == "application/octet-stream" {
      mime = mimeFromExtension(path) ?? "application/octet-stream"
    }
    return mime
  }

  static func contentType(_ mime: String) -> String {
    if mime.hasPrefix("text/") || mime == "application/javascript" || mime == "application/json" || mime == "image/svg+xml" {
      return "\(mime); charset=utf-8"
    }
    return mime
  }

  private static func mimeFromExtension(_ path: String) -> String? {
    let ext = (path as NSString).pathExtension.lowercased()
    let map: [String: String] = [
      "html": "text/html", "htm": "text/html", "css": "text/css", "js": "application/javascript",
      "json": "application/json", "svg": "image/svg+xml", "png": "image/png", "jpg": "image/jpeg",
      "jpeg": "image/jpeg", "gif": "image/gif", "webp": "image/webp", "mp4": "video/mp4",
      "webm": "video/webm", "ogv": "video/ogg", "mp3": "audio/mpeg", "ogg": "audio/ogg",
      "opus": "audio/ogg", "vtt": "text/vtt", "woff": "font/woff", "woff2": "font/woff2",
      "ttf": "font/ttf", "pdf": "application/pdf",
    ]
    return map[ext]
  }
}
