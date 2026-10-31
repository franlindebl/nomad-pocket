// Where the JS module and the CarPlay scene meet. Either can come first: the phone app runs
// without a car, and the car can start the app with the phone locked (React Native then starts
// behind it, CarPlayBoot). The hub keeps what JS last sent and hands it to the car's controller
// when the scene connects; events to JS go through the module once it exists. Main thread only.
import ExpoModulesCore
import Foundation

// MARK: - What JS sends (JSON from src/features/carplay/carplay-core.ts)

struct CarDistance: Decodable {
  let value: Double
  /// m, km, ft, yd, mi
  let unit: String

  var measurement: Measurement<UnitLength> {
    let units: [String: UnitLength] = ["m": .meters, "km": .kilometers, "ft": .feet, "yd": .yards, "mi": .miles]
    return Measurement(value: value, unit: units[unit] ?? .meters)
  }
}

struct CarEstimate: Decodable {
  let distance: CarDistance
  let seconds: Double
}

struct CarStep: Decodable {
  /// Into the route's maneuvers: a new index is a new maneuver on the car's panel.
  let index: Int
  /// routing-core's ManeuverIcon, or "straight-line" (no route: as the crow flies).
  let icon: String
  let instruction: String
  /// The street, for the short variant of the instruction.
  let street: String?
  let estimate: CarEstimate
}

struct CarTarget: Decodable, Equatable {
  let name: String
  let lat: Double
  let lon: Double
}

struct CarGuidance: Decodable {
  let target: CarTarget?
  let navigating: Bool
  /// none, loading, ready, error (guidance.ts RoutingStatus)
  let routing: String
  /// Bumped by JS for every new route, a reroute included.
  let routeId: Int
  let arrived: Bool
  /// The whole trip, for the preview: route or straight line.
  let summary: CarEstimate?
  /// What is left of the trip.
  let remaining: CarEstimate?
  let step: CarStep?
  let nextStep: CarStep?
  /// The trip's preview line under the route ("Por la A-6 · Peajes").
  let note: String?
}

struct CarItem: Decodable {
  let title: String
  let detail: String?
  let lat: Double
  let lon: Double
}

struct CarStrings: Decodable {
  let destinations: String
  let search: String
  let saved: String
  let savedEmpty: String
  let emergency: String
  let emergencyEmpty: String
  let searchEmpty: String
  /// [category id, label] for "Emergencias cerca", in order.
  let categories: [[String]]
  let go: String
  let cancel: String
  let end: String
  let rerouting: String
  let arrived: String
  let noLocation: String
  let straightLine: String
}

// MARK: - Hub

final class CarPlayHub {
  static let shared = CarPlayHub()

  weak var module: NomadCarPlayModule?
  weak var controller: CarPlayController? {
    didSet { if let controller { replay(to: controller) } }
  }
  var connected: Bool { controller != nil }

  private(set) var strings: CarStrings?
  private(set) var styles: (light: String, dark: String)?
  private(set) var route: [[Double]] = []
  private(set) var guidance: CarGuidance?

  private var nextRequest = 0
  private var pending: [Int: ([CarItem]) -> Void] = [:]

  func emit(_ name: String, _ body: [String: Any] = [:]) {
    module?.sendEvent(name, body)
  }

  func setStrings(_ json: String) {
    guard let s: CarStrings = decode(json) else { return }
    strings = s
    controller?.apply(strings: s)
  }

  func setStyles(light: String, dark: String) {
    styles = (light, dark)
    controller?.map.setStyles(light: light, dark: dark)
  }

  func setRoute(_ shape: [[Double]]) {
    route = shape
    controller?.map.setRoute(shape)
  }

  func update(_ json: String) {
    guard let g: CarGuidance = decode(json) else { return }
    guidance = g
    controller?.apply(guidance: g)
  }

  /// Asks JS for list items; `done` gets them, or nothing after a while (JS not running yet).
  func request(_ kind: String, _ extra: [String: Any] = [:], done: @escaping ([CarItem]) -> Void) {
    nextRequest += 1
    let id = nextRequest
    pending[id] = done
    var body = extra
    body["id"] = id
    body["kind"] = kind
    // The car's own fix: JS may have none (no trip, the phone locked) and the lists sort by distance.
    if let here = controller?.map.position {
      body["lat"] = here.latitude
      body["lon"] = here.longitude
    }
    emit("onRequest", body)
    DispatchQueue.main.asyncAfter(deadline: .now() + 8) { [weak self] in
      self?.pending.removeValue(forKey: id)?([])
    }
  }

  func answer(_ id: Int, _ json: String) {
    let items: [CarItem] = decode(json) ?? []
    pending.removeValue(forKey: id)?(items)
  }

  private func replay(to c: CarPlayController) {
    if let strings { c.apply(strings: strings) }
    if let styles { c.map.setStyles(light: styles.light, dark: styles.dark) }
    c.map.setRoute(route)
    if let guidance { c.apply(guidance: guidance) }
  }

  private func decode<T: Decodable>(_ json: String) -> T? {
    do {
      return try JSONDecoder().decode(T.self, from: Data(json.utf8))
    } catch {
      NSLog("[carplay] bad JSON from JS: \(error)")
      return nil
    }
  }
}
