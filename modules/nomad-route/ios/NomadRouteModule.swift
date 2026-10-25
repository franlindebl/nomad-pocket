import ExpoModulesCore
import Foundation

final class RouterNotOpenException: Exception, @unchecked Sendable {
  override var reason: String { "No routing pack is open" }
}

/// "valhalla <code>: <message>", parsed by src/features/maps/routing-core.ts.
final class RoutingFailedException: GenericException<String>, @unchecked Sendable {
  override var reason: String { param }

  convenience init(_ error: NSError) {
    self.init("valhalla \(error.code): \(error.localizedDescription)")
  }
}

/// Serial: a Valhalla actor is not safe to use from two threads, and a route takes
/// milliseconds, so queueing is fine. Never the JS or main thread.
let routeQueue = DispatchQueue(label: "nomad.route", qos: .userInitiated)

public final class NomadRouteModule: Module {
  private var router: NRRouter?
  private var openConfig: String?

  public func definition() -> ModuleDefinition {
    Name("NomadRoute")

    /// Opens (or reuses) a Valhalla actor for a config JSON. Reopening with the same
    /// config is free; another pack replaces the actor.
    AsyncFunction("open") { (configJson: String) in
      if self.openConfig == configJson, self.router != nil { return }
      self.router = nil
      self.openConfig = nil
      do {
        // valhalla-mobile builds its actor from a file; one fixed name, rewritten per pack
        // (the actor has read it by the time the initializer returns).
        try Self.installTzdata()
        let url = try Self.supportDir().appendingPathComponent("valhalla.json")
        try Data(configJson.utf8).write(to: url, options: .atomic)
        self.router = try NRRouter(configPath: url.path)
        self.openConfig = configJson
      } catch let error as NSError {
        throw RoutingFailedException(error)
      }
    }.runOnQueue(routeQueue)

    AsyncFunction("close") {
      self.router = nil
      self.openConfig = nil
    }.runOnQueue(routeQueue)

    AsyncFunction("route") { (request: String) -> String in
      try self.run { try $0.route(request) }
    }.runOnQueue(routeQueue)

    AsyncFunction("matrix") { (request: String) -> String in
      try self.run { try $0.matrix(request) }
    }.runOnQueue(routeQueue)
  }

  private static func supportDir() throws -> URL {
    let dir = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("NomadRoute", isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir
  }

  /// Valhalla's date library reads the IANA database from Library/tzdata (time-dependent
  /// restrictions, departure times). It ships as tzdata.tar in the app bundle (podspec).
  private static func installTzdata() throws {
    let lib = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask)[0]
    let dest = lib.appendingPathComponent("tzdata", isDirectory: true)
    // Our own marker, written last: a kill mid-untar must not leave a half database.
    let marker = dest.appendingPathComponent(".nomad-complete")
    if FileManager.default.fileExists(atPath: marker.path) { return }
    guard let tar = Bundle.main.url(forResource: "tzdata", withExtension: "tar") else { return }
    try untar(try Data(contentsOf: tar), into: dest)
    try Data().write(to: marker)
  }

  /// Minimal ustar reader: regular files and directories, which is all tzdata.tar holds.
  static func untar(_ data: Data, into dest: URL) throws {
    let fm = FileManager.default
    try fm.createDirectory(at: dest, withIntermediateDirectories: true)
    var offset = 0
    func field(_ from: Int, _ len: Int) -> String {
      let bytes = data[(offset + from)..<(offset + from + len)].prefix { $0 != 0 }
      return String(decoding: bytes, as: UTF8.self)
    }
    while offset + 512 <= data.count {
      if data[offset..<(offset + 512)].allSatisfy({ $0 == 0 }) { break }
      let name = field(0, 100)
      let prefix = field(345, 155)
      let size = Int(field(124, 12).trimmingCharacters(in: .whitespaces), radix: 8) ?? 0
      let type = data[offset + 156]
      let path = (prefix.isEmpty ? name : "\(prefix)/\(name)").replacingOccurrences(of: "./", with: "")
      let start = offset + 512
      if !path.isEmpty, !path.contains("..") {
        let url = dest.appendingPathComponent(path)
        if type == UInt8(ascii: "5") {
          try fm.createDirectory(at: url, withIntermediateDirectories: true)
        } else if type == UInt8(ascii: "0") || type == 0 {
          try fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
          try data[start..<min(start + size, data.count)].write(to: url)
        }
      }
      offset = start + (size + 511) / 512 * 512
    }
  }

  private func run(_ action: (NRRouter) throws -> String) throws -> String {
    guard let router else { throw RouterNotOpenException() }
    do {
      return try action(router)
    } catch let error as NSError {
      throw RoutingFailedException(error)
    }
  }
}
