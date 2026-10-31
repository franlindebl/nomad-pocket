// The map on the car's screen: MapLibre Native with the style JS builds for the phone (the same
// offline PMTiles, glyphs and sprites), the route line, the destination and the user's position.
// The system draws its templates (buttons, maneuver panel) on top, so the camera keeps the user
// inside the map template's safe area. Following: course up and tilted while navigating, north
// up otherwise; a pan from the car's buttons stops following until "recentre" (a zoom doesn't).
// The position and the camera are ours, not MapLibre's user tracking (CarLocationManager says why);
// the user, the route and the destination are style layers, redrawn after every style change.
import CoreLocation
import MapLibre
import UIKit

final class CarMapViewController: UIViewController, MLNMapViewDelegate {
  private(set) var mapView: MLNMapView!
  private let location = CarLocationManager()
  private var styles: (light: String, dark: String)?
  private var appliedStyle: String?
  private var route: [CLLocationCoordinate2D] = []
  /// The route's segment the user is on: what's behind it is no longer drawn.
  private var routeSegment = 0
  private var destination: CLLocationCoordinate2D?
  private var here: CLLocation?
  /// Where the user is, as the car map last knew it.
  var position: CLLocationCoordinate2D? { here?.coordinate }
  /// Which way is up while navigating: the last GPS course while moving.
  private var course: CLLocationDirection = 0
  private var navigating = false
  /// Following the user (false after a pan or an overview).
  private(set) var following = true
  /// Told when following stops or starts (the recentre button shows meanwhile).
  var onFollowingChange: ((Bool) -> Void)?

  override func loadView() {
    let map = MLNMapView(frame: .zero)
    map.delegate = self
    map.logoView.isHidden = true
    map.attributionButton.isHidden = true
    map.compassView.isHidden = true
    map.automaticallyAdjustsContentInset = false
    // Before the style: setting it calls didFinishLoading right away, which draws on mapView.
    mapView = map
    // MapLibre's default style is a demo world map fetched from the internet: never. A plain
    // background until JS sends the offline style.
    map.styleJSON = ##"{"version":8,"sources":{},"layers":[{"id":"background","type":"background","paint":{"background-color":"#d9d6cf"}}]}"##
    view = map
  }

  override func viewDidLoad() {
    super.viewDidLoad()
    // Until the first fix: where the phone last was, not the middle of the ocean at 0, 0.
    mapView.zoomLevel = 15
    if let last = location.last {
      here = last
      mapView.setCenter(last.coordinate, zoomLevel: 15, animated: false)
    }
    location.onFix = { [weak self] fix in self?.moved(to: fix) }
    location.start()
  }

  override func viewSafeAreaInsetsDidChange() {
    super.viewSafeAreaInsetsDidChange()
    // The maneuver panel or the preview card came or went: the user stays in the free part.
    if following { follow(animated: true) }
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
    routeSegment = 0
    drawLayers()
  }

  func setDestination(_ target: CarTarget?) {
    let next = target.map { CLLocationCoordinate2D(latitude: $0.lat, longitude: $0.lon) }
    if next?.latitude == destination?.latitude && next?.longitude == destination?.longitude { return }
    destination = next
    drawLayers()
  }

  func setNavigating(_ on: Bool) {
    guard on != navigating else { return }
    navigating = on
    if on { setFollowing(true) }
    drawLayers()
    if following { follow(animated: true) }
  }

  /// The whole route (or the straight line to the target) above the trip preview.
  func showOverview(of target: CarTarget) {
    var points = route
    if points.isEmpty {
      points = [CLLocationCoordinate2D(latitude: target.lat, longitude: target.lon)]
      if let here { points.append(here.coordinate) }
    }
    setFollowing(false)
    guard points.count > 1 else {
      mapView.setCenter(points[0], zoomLevel: 14, animated: true)
      return
    }
    // Flat and north up first: the fit is computed for the current pitch.
    let flat = mapView.camera
    flat.pitch = 0
    flat.heading = 0
    mapView.setCamera(flat, animated: false)
    mapView.setVisibleCoordinates(points, count: UInt(points.count), edgePadding: overviewPadding(), animated: true)
  }

  // MARK: Camera

  func recentre() {
    setFollowing(true)
    // Back from a trip's overview: street level again.
    if !navigating && mapView.zoomLevel < 13 { mapView.setZoomLevel(15, animated: false) }
    follow(animated: true)
  }

  func zoom(by delta: Double) {
    // A zoom keeps following, like Apple Maps: only the distance changes.
    mapView.setZoomLevel(min(19, max(3, mapView.zoomLevel + delta)), animated: true)
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
    onFollowingChange?(on)
  }

  private func moved(to fix: CLLocation) {
    here = fix
    if fix.speed > 2 && fix.course >= 0 { course = fix.course }
    drawLayers()
    if following { follow(animated: true) }
  }

  /// The camera on the user: course up and tilted while navigating, north up and flat otherwise.
  private func follow(animated: Bool) {
    guard isViewLoaded, let here else { return }
    // The zoom first, on its own: animated next to the camera move, one cancelled the other.
    if navigating && mapView.zoomLevel < 14 { mapView.zoomLevel = 16 }
    let camera = mapView.camera
    camera.centerCoordinate = here.coordinate
    camera.heading = navigating ? course : 0
    camera.pitch = navigating ? 45 : 0
    mapView.setCamera(
      camera, withDuration: animated ? 0.8 : 0, animationTimingFunction: CAMediaTimingFunction(name: .linear),
      edgePadding: insets(), completionHandler: nil)
  }

  /// Where the user goes: inside the template's safe area (it moves with the maneuver panel and
  /// the trip preview), low on the screen while navigating. Passed with each camera move, not as
  /// MapLibre's contentInset: a camera set on a map with an inset ignored it (the user ended up
  /// behind the maneuver panel).
  private func insets() -> UIEdgeInsets {
    let safe = view.safeAreaInsets
    let low = navigating && following ? max(0, view.bounds.height - safe.top - safe.bottom) * 0.35 : 0
    return UIEdgeInsets(top: safe.top + low, left: safe.left, bottom: safe.bottom, right: safe.right)
  }

  private func overviewPadding() -> UIEdgeInsets {
    let i = insets()
    return UIEdgeInsets(top: i.top + 16, left: i.left + 16, bottom: i.bottom + 16, right: i.right + 16)
  }

  // MARK: Layers

  private func point(_ c: CLLocationCoordinate2D?) -> MLNShape? {
    guard let c else { return nil }
    let p = MLNPointFeature()
    p.coordinate = c
    return p
  }

  /// Sets a source's shape, creating the source and its layers the first time (per style).
  private func shape(_ id: String, _ shape: MLNShape?, layers: (MLNShapeSource) -> [MLNStyleLayer]) {
    guard let style = mapView.style else { return }
    if let source = style.source(withIdentifier: id) as? MLNShapeSource {
      source.shape = shape
      return
    }
    let source = MLNShapeSource(identifier: id, shape: shape, options: nil)
    style.addSource(source)
    for layer in layers(source) { style.addLayer(layer) }
  }

  private func drawLayers() {
    guard mapView.style != nil else { return }
    let blue = UIColor(red: 0.18, green: 0.5, blue: 0.98, alpha: 1)
    // What's left of the route while navigating: from the user's point on it (like the phone).
    let ahead = navigating ? remainingRoute() : route
    // MapLibre throws on a polyline with no points (the style loads before any route).
    let line = ahead.count > 1 ? MLNPolylineFeature(coordinates: ahead, count: UInt(ahead.count)) : nil
    shape("car-route", line) { source in
      let casing = MLNLineStyleLayer(identifier: "car-route-casing", source: source)
      casing.lineColor = NSExpression(forConstantValue: UIColor(red: 0.05, green: 0.25, blue: 0.6, alpha: 1))
      casing.lineWidth = NSExpression(mglJSONObject: ["interpolate", ["exponential", 1.5], ["zoom"], 10, 5, 18, 22])
      let fill = MLNLineStyleLayer(identifier: "car-route", source: source)
      fill.lineColor = NSExpression(forConstantValue: blue)
      fill.lineWidth = NSExpression(mglJSONObject: ["interpolate", ["exponential", 1.5], ["zoom"], 10, 3, 18, 16])
      for l in [casing, fill] {
        l.lineCap = NSExpression(forConstantValue: "round")
        l.lineJoin = NSExpression(forConstantValue: "round")
      }
      return [casing, fill]
    }
    shape("car-destination", point(destination)) { source in
      let dot = MLNCircleStyleLayer(identifier: "car-destination", source: source)
      dot.circleRadius = NSExpression(forConstantValue: 9)
      dot.circleColor = NSExpression(forConstantValue: UIColor(red: 0.9, green: 0.2, blue: 0.2, alpha: 1))
      dot.circleStrokeColor = NSExpression(forConstantValue: UIColor.white)
      dot.circleStrokeWidth = NSExpression(forConstantValue: 3)
      return [dot]
    }
    shape("car-user", point(here?.coordinate)) { source in
      let halo = MLNCircleStyleLayer(identifier: "car-user-halo", source: source)
      halo.circleRadius = NSExpression(forConstantValue: 16)
      halo.circleColor = NSExpression(forConstantValue: blue.withAlphaComponent(0.2))
      halo.circlePitchAlignment = NSExpression(forConstantValue: "viewport")
      let dot = MLNCircleStyleLayer(identifier: "car-user", source: source)
      dot.circleRadius = NSExpression(forConstantValue: 8)
      dot.circleColor = NSExpression(forConstantValue: blue)
      dot.circleStrokeColor = NSExpression(forConstantValue: UIColor.white)
      dot.circleStrokeWidth = NSExpression(forConstantValue: 3)
      dot.circlePitchAlignment = NSExpression(forConstantValue: "viewport")
      return [halo, dot]
    }
  }

  /// The route from the user's position on it: the nearest segment, searched a little behind and
  /// ahead of the last one (a route can pass near itself), the user's point projected onto it.
  private func remainingRoute() -> [CLLocationCoordinate2D] {
    guard route.count > 1, let here else { return route }
    let p = here.coordinate
    let k = cos(p.latitude * .pi / 180)
    func project(_ i: Int) -> (CLLocationCoordinate2D, Double) {
      let a = route[i], b = route[i + 1]
      let ax = (a.longitude - p.longitude) * k, ay = a.latitude - p.latitude
      let bx = (b.longitude - p.longitude) * k, by = b.latitude - p.latitude
      let dx = bx - ax, dy = by - ay
      let len = dx * dx + dy * dy
      let t = len > 0 ? max(0, min(1, -(ax * dx + ay * dy) / len)) : 0
      let x = ax + t * dx, y = ay + t * dy
      return (CLLocationCoordinate2D(latitude: a.latitude + t * (b.latitude - a.latitude), longitude: a.longitude + t * (b.longitude - a.longitude)), x * x + y * y)
    }
    let from = max(0, routeSegment - 5), to = min(route.count - 2, routeSegment + 200)
    var best = (segment: routeSegment, point: route[routeSegment], d: Double.infinity)
    for i in from...to {
      let (q, d) = project(i)
      if d < best.d { best = (i, q, d) }
    }
    routeSegment = best.segment
    return [best.point] + route[(best.segment + 1)...]
  }

  // MARK: MLNMapViewDelegate

  func mapView(_ mapView: MLNMapView, didFinishLoading style: MLNStyle) {
    // A new style (day / night, a map installed) has none of our layers.
    drawLayers()
    if following { follow(animated: false) }
  }

  func mapViewDidFailLoadingMap(_ mapView: MLNMapView, withError error: Error) {
    NSLog("[carplay] map failed to load: %@", error.localizedDescription)
  }
}
