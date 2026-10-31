// The map on the car's screen: MapLibre Native with the style JS builds for the phone (the same
// offline PMTiles, glyphs and sprites), the route line, the destination and the user's position.
// The system draws its templates (buttons, maneuver panel) on top, so the camera keeps the user
// inside the map template's safe area. Following: course up and tilted while navigating, north
// up otherwise; a pan or zoom from the car's buttons stops following until "recentre".
import CoreLocation
import MapLibre
import UIKit

final class CarMapViewController: UIViewController, MLNMapViewDelegate {
  private(set) var mapView: MLNMapView!
  private var styles: (light: String, dark: String)?
  private var appliedStyle: String?
  private var route: [CLLocationCoordinate2D] = []
  private var destination: MLNPointAnnotation?
  private var navigating = false
  /// Our own camera moves, which end tracking on the way.
  private var adjusting = false
  /// Following the user (false after a pan or a zoom from the car's buttons).
  private(set) var following = true
  /// Told when following stops or starts (the recentre button shows meanwhile).
  var onFollowingChange: ((Bool) -> Void)?

  override func loadView() {
    let map = MLNMapView(frame: .zero)
    map.delegate = self
    map.locationManager = CarLocationManager()
    map.logoView.isHidden = true
    map.attributionButton.isHidden = true
    map.compassView.isHidden = true
    map.showsUserLocation = true
    map.automaticallyAdjustsContentInset = false
    map.zoomLevel = 15
    mapView = map
    view = map
  }

  override func viewDidLoad() {
    super.viewDidLoad()
    follow(animated: false)
  }

  override func viewSafeAreaInsetsDidChange() {
    super.viewSafeAreaInsetsDidChange()
    applyInsets()
  }

  override func traitCollectionDidChange(_ previous: UITraitCollection?) {
    super.traitCollectionDidChange(previous)
    // Day and night follow the car (its headlights or its setting), not the phone.
    if traitCollection.userInterfaceStyle != previous?.userInterfaceStyle { applyStyle() }
  }

  // MARK: Content

  func setStyles(light: String, dark: String) {
    styles = (light, dark)
    applyStyle()
  }

  private func applyStyle() {
    guard let styles, isViewLoaded else { return }
    let json = traitCollection.userInterfaceStyle == .dark ? styles.dark : styles.light
    guard json != appliedStyle else { return }
    appliedStyle = json
    mapView.styleJSON = json
  }

  func setRoute(_ shape: [[Double]]) {
    route = shape.compactMap { $0.count >= 2 ? CLLocationCoordinate2D(latitude: $0[1], longitude: $0[0]) : nil }
    drawRoute()
  }

  func setDestination(_ target: CarTarget?) {
    if let destination, let target, destination.coordinate.latitude == target.lat, destination.coordinate.longitude == target.lon { return }
    if let destination { mapView.removeAnnotation(destination) }
    destination = nil
    guard let target else { return }
    let pin = MLNPointAnnotation()
    pin.coordinate = CLLocationCoordinate2D(latitude: target.lat, longitude: target.lon)
    pin.title = target.name
    mapView.addAnnotation(pin)
    destination = pin
  }

  func setNavigating(_ on: Bool) {
    guard on != navigating else { return }
    navigating = on
    if on { following = true }
    if following { follow(animated: true) }
  }

  /// The whole route (or the straight line to the target) above the trip preview.
  func showOverview(of target: CarTarget) {
    var points = route
    if points.isEmpty {
      points = [CLLocationCoordinate2D(latitude: target.lat, longitude: target.lon)]
      if let here = mapView.userLocation?.location?.coordinate { points.append(here) }
    }
    setFollowing(false)
    guard points.count > 1 else {
      mapView.setCenter(points[0], zoomLevel: 14, animated: true)
      return
    }
    let camera = mapView.cameraThatFitsShape(MLNPolyline(coordinates: points, count: UInt(points.count)), direction: 0, edgePadding: overviewPadding())
    mapView.setCamera(camera, animated: true)
  }

  // MARK: Camera

  func recentre() {
    setFollowing(true)
    follow(animated: true)
  }

  func zoom(by delta: Double) {
    // A zoom keeps following, like Apple Maps: only the distance changes.
    adjusting = true
    mapView.setZoomLevel(mapView.zoomLevel + delta, animated: true)
    adjusting = false
    if following && mapView.userTrackingMode == .none {
      mapView.setUserTrackingMode(navigating ? .followWithCourse : .follow, animated: true, completionHandler: nil)
    }
  }

  func pan(_ direction: CGVector) {
    setFollowing(false)
    let size = mapView.bounds.size
    let centre = CGPoint(x: size.width / 2 + direction.dx * size.width / 3, y: size.height / 2 + direction.dy * size.height / 3)
    mapView.setCenter(mapView.convert(centre, toCoordinateFrom: mapView), animated: true)
  }

  private func setFollowing(_ on: Bool) {
    guard on != following else { return }
    following = on
    if !on { mapView.setUserTrackingMode(.none, animated: false, completionHandler: nil) }
    onFollowingChange?(on)
  }

  private func follow(animated: Bool) {
    guard isViewLoaded else { return }
    applyInsets()
    // The camera first: a camera change ends tracking, a tracking change keeps the pitch.
    adjusting = true
    defer { adjusting = false }
    let camera = mapView.camera
    camera.pitch = navigating ? 45 : 0
    if !navigating { camera.heading = 0 }
    mapView.setCamera(camera, animated: false)
    if navigating && mapView.zoomLevel < 15 { mapView.zoomLevel = 16 }
    mapView.setUserTrackingMode(navigating ? .followWithCourse : .follow, animated: animated, completionHandler: nil)
  }

  /// The template's safe area (it moves with the maneuver panel); navigating, the user sits low.
  private func applyInsets() {
    guard isViewLoaded else { return }
    let safe = view.safeAreaInsets
    let height = view.bounds.height
    let low = navigating && following ? max(0, height - safe.top - safe.bottom) * 0.35 : 0
    mapView.setContentInset(UIEdgeInsets(top: safe.top + low, left: safe.left, bottom: safe.bottom, right: safe.right), animated: false, completionHandler: nil)
  }

  private func overviewPadding() -> UIEdgeInsets {
    let safe = view.safeAreaInsets
    return UIEdgeInsets(top: safe.top + 24, left: safe.left + 24, bottom: safe.bottom + 24, right: safe.right + 24)
  }

  // MARK: Route layers

  private func drawRoute() {
    guard let style = mapView.style else { return }
    let line = MLNPolylineFeature(coordinates: route, count: UInt(route.count))
    if let source = style.source(withIdentifier: "car-route") as? MLNShapeSource {
      source.shape = route.count > 1 ? line : nil
      return
    }
    let source = MLNShapeSource(identifier: "car-route", shape: route.count > 1 ? line : nil, options: nil)
    style.addSource(source)
    let casing = MLNLineStyleLayer(identifier: "car-route-casing", source: source)
    casing.lineColor = NSExpression(forConstantValue: UIColor(red: 0.05, green: 0.25, blue: 0.6, alpha: 1))
    casing.lineWidth = NSExpression(mglJSONObject: ["interpolate", ["exponential", 1.5], ["zoom"], 10, 5, 18, 22])
    casing.lineCap = NSExpression(forConstantValue: "round")
    casing.lineJoin = NSExpression(forConstantValue: "round")
    let fill = MLNLineStyleLayer(identifier: "car-route", source: source)
    fill.lineColor = NSExpression(forConstantValue: UIColor(red: 0.18, green: 0.5, blue: 0.98, alpha: 1))
    fill.lineWidth = NSExpression(mglJSONObject: ["interpolate", ["exponential", 1.5], ["zoom"], 10, 3, 18, 16])
    fill.lineCap = NSExpression(forConstantValue: "round")
    fill.lineJoin = NSExpression(forConstantValue: "round")
    // Under the labels: the first symbol layer of the basemap.
    if let labels = style.layers.first(where: { $0 is MLNSymbolStyleLayer }) {
      style.insertLayer(casing, below: labels)
      style.insertLayer(fill, below: labels)
    } else {
      style.addLayer(casing)
      style.addLayer(fill)
    }
  }

  // MARK: MLNMapViewDelegate

  func mapView(_ mapView: MLNMapView, didFinishLoading style: MLNStyle) {
    drawRoute()
  }

  func mapView(_ mapView: MLNMapView, didChange mode: MLNUserTrackingMode, animated: Bool) {
    // MapLibre drops tracking by itself on some camera moves: that is the end of following too.
    if mode == .none && following && !adjusting { setFollowing(false) }
  }
}
