// The car map's location source. MapLibre's default location manager stops when the app is in
// the background, and with the phone locked in a car only the CarPlay scene is in front: the
// puck froze. This one is a plain CLLocationManager allowed to run in the background (the app has
// the location background mode, see app.json), handed to MLNMapView.
import CoreLocation
import MapLibre

final class CarLocationManager: NSObject, MLNLocationManager, CLLocationManagerDelegate {
  private let manager = CLLocationManager()
  weak var delegate: MLNLocationManagerDelegate?

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

  var authorizationStatus: CLAuthorizationStatus { manager.authorizationStatus }

  var headingOrientation: CLDeviceOrientation {
    get { manager.headingOrientation }
    set { manager.headingOrientation = newValue }
  }

  func requestAlwaysAuthorization() {
    // Never: "While Using" is all the app asks for.
  }

  func requestWhenInUseAuthorization() {
    // The phone asks, where the person can read why (the car can't show the prompt).
  }

  func startUpdatingLocation() { manager.startUpdatingLocation() }
  func stopUpdatingLocation() { manager.stopUpdatingLocation() }

  // In a car the phone sits anywhere: the course, not the compass, says which way is ahead.
  func startUpdatingHeading() {}
  func stopUpdatingHeading() {}
  func dismissHeadingCalibrationDisplay() {}

  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    delegate?.locationManager(self, didUpdate: locations)
  }

  func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    delegate?.locationManager(self, didFailWithError: error)
  }

  func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    delegate?.locationManagerDidChangeAuthorization(self)
  }
}
