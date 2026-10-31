// The navigation watch on iOS: GPS fixes that keep coming with the screen locked, the app in the
// background or only CarPlay on screen. Everything else about location on iOS is expo-location,
// but its watchPositionAsync hard-codes `allowsBackgroundLocationUpdates = false`, and its
// background API needs expo-task-manager and the "Always" permission. A watch started in the
// foreground with the location background mode only needs "While Using" (the blue pill shows).
import CoreLocation
import ExpoModulesCore

public final class NomadLocationModule: Module {
  private var watches: [Int: NavigationWatch] = [:]

  public func definition() -> ModuleDefinition {
    Name("NomadLocation")
    Events("onNavigation")

    /// Fixes arrive as onNavigation events. title/body: Android's notification, unused here.
    AsyncFunction("startNavigation") { (id: Int, distance: Double, _: Double, _: String, _: String, automotive: Bool) in
      self.watches.removeValue(forKey: id)?.stop()
      let watch = NavigationWatch(distance: distance, automotive: automotive) { [weak self] fix in
        self?.sendEvent("onNavigation", ["watchId": id, "location": fix])
      }
      self.watches[id] = watch
      watch.start()
    }.runOnQueue(.main)

    AsyncFunction("stopNavigation") { (id: Int) in
      self.watches.removeValue(forKey: id)?.stop()
    }.runOnQueue(.main)

    OnDestroy {
      DispatchQueue.main.async {
        self.watches.values.forEach { $0.stop() }
        self.watches.removeAll()
      }
    }
  }
}

private final class NavigationWatch: NSObject, CLLocationManagerDelegate {
  private let manager = CLLocationManager()
  private let onFix: ([String: Any]) -> Void

  init(distance: Double, automotive: Bool, onFix: @escaping ([String: Any]) -> Void) {
    self.onFix = onFix
    super.init()
    manager.delegate = self
    manager.desiredAccuracy = kCLLocationAccuracyBestForNavigation
    manager.distanceFilter = distance > 0 ? distance : kCLDistanceFilterNone
    manager.activityType = automotive ? .automotiveNavigation : .otherNavigation
    // A stop at a red light or a rest must not end the updates for good.
    manager.pausesLocationUpdatesAutomatically = false
    // Setting it without the background mode in Info.plist raises an exception.
    let modes = Bundle.main.object(forInfoDictionaryKey: "UIBackgroundModes") as? [String] ?? []
    if modes.contains("location") {
      manager.allowsBackgroundLocationUpdates = true
      manager.showsBackgroundLocationIndicator = true
    }
  }

  func start() { manager.startUpdatingLocation() }

  func stop() {
    manager.stopUpdatingLocation()
    manager.delegate = nil
  }

  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    for location in locations { onFix(Self.toDict(location)) }
  }

  func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    // kCLErrorLocationUnknown is transient (a tunnel); a denial shows in JS through the permission.
  }

  /// expo-location's LocationObject shape.
  private static func toDict(_ l: CLLocation) -> [String: Any] {
    return [
      "coords": [
        "latitude": l.coordinate.latitude,
        "longitude": l.coordinate.longitude,
        "altitude": l.altitude,
        "accuracy": l.horizontalAccuracy,
        "altitudeAccuracy": l.verticalAccuracy,
        "heading": l.course,
        "speed": l.speed,
      ],
      "timestamp": l.timestamp.timeIntervalSince1970 * 1000,
      "mocked": false,
    ]
  }
}
