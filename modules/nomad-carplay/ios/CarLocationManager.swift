// The car map's location. MapLibre's own user location never started on the car's screen: its map
// view counts as dormant while the phone app isn't in front, which with CarPlay is most of the
// time (seen in the simulator: no fix, the camera stuck at 0, 0). So the car map follows the user
// itself, from this plain CLLocationManager allowed to run in the background (the app has the
// location background mode, see app.json).
import CoreLocation

final class CarLocationManager: NSObject, CLLocationManagerDelegate {
  private let manager = CLLocationManager()
  var onFix: ((CLLocation) -> Void)?

  override init() {
    super.init()
    manager.delegate = self
    manager.desiredAccuracy = kCLLocationAccuracyBestForNavigation
    manager.activityType = .automotiveNavigation
    manager.pausesLocationUpdatesAutomatically = false
    let modes = Bundle.main.object(forInfoDictionaryKey: "UIBackgroundModes") as? [String] ?? []
    if modes.contains("location") {
      manager.allowsBackgroundLocationUpdates = true
      manager.showsBackgroundLocationIndicator = true
    }
  }

  /// The last fix the phone has, before the first new one.
  var last: CLLocation? { manager.location }

  // Never asks: the car can't show the prompt; the phone asks when the person opens Maps there.
  func start() { manager.startUpdatingLocation() }
  func stop() { manager.stopUpdatingLocation() }

  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    if let fix = locations.last { onFix?(fix) }
  }

  func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    // kCLErrorLocationUnknown is transient (a tunnel); the map keeps the last position.
  }

  func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    // Granted on the phone while the car shows the map: start now.
    if manager.authorizationStatus == .authorizedWhenInUse || manager.authorizationStatus == .authorizedAlways { start() }
  }
}
