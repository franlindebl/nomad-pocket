// The car map: MapLibre Native with the style JS builds for the phone (the same offline PMTiles,
// glyphs and sprites, dark like the app), the route line, the destination and the user, drawn as
// the phone's Maps tab draws them (CarColors). The system draws its templates (buttons, maneuver
// panel) on top, so the camera keeps the user inside the map template's safe area.
//
// Following while navigating is the phone's camera: JS computes each move with follow-core (the
// user snapped onto the route, the road's bearing turned at a bounded rate, a glide a little
// longer than the fix rhythm aimed at where the user will be) and sends it with guidance; this
// side only plays it with the padding of the car's screen. Each move used to go to the raw fix in
// 0.8 s and turn to the raw GPS course: at a fix a second the map stopped and started again, the
// jerks the owner saw in a car. Without a trip it glides here the same way, north up. A pan from
// the car's buttons stops following until "recentre" (a zoom doesn't).
//
// While following, the user is a view at the camera's centre (the phone's FollowArrow): it stays
// put while the map glides under it, where a style layer moved to each fix would jump. Otherwise
// (looking around, a trip's overview) the user is a dot layer at the fix. The position is ours
// (CarLocationManager says why), not MapLibre's user tracking.
import CoreLocation
import MapLibre
import UIKit

/** The phone's map colours (src/theme/tokens.ts and the Maps tab's layers): keep them in step. */
enum CarColors {
  static func hex(_ rgb: UInt32, _ alpha: CGFloat = 1) -> UIColor {
    UIColor(red: CGFloat((rgb >> 16) & 0xFF) / 255, green: CGFloat((rgb >> 8) & 0xFF) / 255, blue: CGFloat(rgb & 0xFF) / 255, alpha: alpha)
  }
  /** Signal yellow: the route, the destination, the maneuver symbols. */
  static let accent = hex(0xFFD60A)
  /** Panels, and the casing around what is drawn on the map. */
  static let surface = hex(0x131313)
  static let onAccent = hex(0x0C0C0C)
  /** The user's position (puck and arrow). */
  static let location = hex(0x4C8DF6)
  /** The arrow with a rough or lost fix. */
  static let weak = hex(0x5F5F5A)
  /** The dark basemap's background (@protomaps/basemaps, dark flavour), until JS sends the style. */
  static let mapBackground = "#34373d"
}

final class CarMapViewController: UIViewController, MLNMapViewDelegate {
  private(set) var mapView: MLNMapView!
  private let location = CarLocationManager()
  private var styles: (light: String, dark: String)?
  private var appliedStyle: String?
  private var route: [CLLocationCoordinate2D] = []
  /// The route's segment the user is on, when the car measures it itself (no cut from JS).
  private var routeSegment = 0
  /// Where JS has the user on the route: the travelled part is cut off there, as on the phone.
  private var cut: CarCut?
  private var destination: CLLocationCoordinate2D?
  private var here: CLLocation?
  /// Where the user is, as the car map last knew it.
  var position: CLLocationCoordinate2D? { here?.coordinate }
  private var navigating = false
  /// Following the user (false after a pan or an overview).
  private(set) var following = true
  /// Told when following stops or starts (the recentre button shows meanwhile).
  var onFollowingChange: ((Bool) -> Void)?

  /// Navigating: the last move JS sent (recentre goes back to it).
  private var lastFrame: CarCamera?
  /// The settling move (start of following) runs until then; moves that come meanwhile wait.
  private var settleUntil: Date?
  private var pendingFrame: CarCamera?
  private var settleToken = 0
  /// The camera has reached the user: the overlay (arrow or dot) stands for them from now on.
  private var settled = false
  /// The car's zoom buttons while navigating, on top of follow-core's zoom.
  private var zoomOffset = 0.0
  /// Without a trip: the zoom the glide keeps.
  private var freeZoom = 15.0
  /// The fix rhythm without a trip (s, smoothed) and the last fix's time.
  private var gap = 1.0
  private var fixAt: Date?

  private let arrow = CarArrowView(frame: CGRect(x: 0, y: 0, width: 40, height: 40))
  private let dot = CarDotView(frame: CGRect(x: 0, y: 0, width: 36, height: 36))
  private var weakTimer: Timer?
  private let speed = CarSpeedView(frame: .zero)

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
    map.styleJSON = #"{"version":8,"sources":{},"layers":[{"id":"background","type":"background","paint":{"background-color":"\#(CarColors.mapBackground)"}}]}"#
    for v in [dot, arrow] as [UIView] {
      v.isHidden = true
      v.isUserInteractionEnabled = false
      map.addSubview(v)
    }
    view = map
    // Top left of the free part of the map (the system keeps its panels and buttons out of the safe
    // area): at the bottom, as on the phone, it sat next to the arrow on a car's short screen.
    speed.translatesAutoresizingMaskIntoConstraints = false
    map.addSubview(speed)
    NSLayoutConstraint.activate([
      speed.leadingAnchor.constraint(equalTo: map.safeAreaLayoutGuide.leadingAnchor, constant: 10),
      speed.topAnchor.constraint(equalTo: map.safeAreaLayoutGuide.topAnchor, constant: 10),
    ])
  }

  override func viewDidLoad() {
    super.viewDidLoad()
    // Until the first fix: where the phone last was, not the middle of the ocean at 0, 0.
    mapView.zoomLevel = freeZoom
    if let last = location.last {
      here = last
      mapView.setCenter(last.coordinate, zoomLevel: freeZoom, animated: false)
    }
    location.onFix = { [weak self] fix in self?.moved(to: fix) }
    location.start()
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    placeOverlay()
  }

  override func viewSafeAreaInsetsDidChange() {
    super.viewSafeAreaInsetsDidChange()
    placeOverlay()
    // The maneuver panel or the preview card came or went: the user stays in the free part.
    if following { refollow() }
  }

  override func traitCollectionDidChange(_ previous: UITraitCollection?) {
    super.traitCollectionDidChange(previous)
    // JS sends the dark style for both (the app is dark only); kept so a light one would follow the car.
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
    cut = nil
    drawLayers()
  }

  func setCut(_ next: CarCut?) {
    guard next != cut else { return }
    cut = next
    drawLayers()
  }

  func setSpeed(_ value: CarSpeed?) {
    speed.show(value)
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
    lastFrame = nil
    pendingFrame = nil
    zoomOffset = 0
    setSettled(false)
    if on {
      setFollowing(true)
      // JS sends the settling move with the state that started navigation.
    } else if following {
      settle(freeCamera(), duration: 1)
    }
    drawLayers()
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

  /// Navigating: follow-core's next move, from JS with a new fix.
  func apply(camera c: CarCamera) {
    guard navigating else { return }
    lastFrame = c
    guard following else { return }
    // The first move of a trip, or the first this car map gets (it connected mid-trip): one settling ease.
    if c.first || (!settled && settleUntil == nil) {
      settle(navCamera(c), duration: c.first ? Double(c.duration) / 1000 : 1)
    } else if let until = settleUntil, Date() < until {
      pendingFrame = c
    } else {
      move(navCamera(c), duration: Double(c.duration) / 1000, timing: .linear)
    }
  }

  func recentre() {
    setFollowing(true)
    if navigating {
      if let lastFrame { settle(navCamera(lastFrame), duration: 1) }
    } else {
      // Back from a trip's overview: street level again.
      if mapView.zoomLevel < 13 { freeZoom = 15 }
      settle(freeCamera(), duration: 1)
    }
  }

  func zoom(by delta: Double) {
    // A zoom keeps following, like Apple Maps: only the distance changes, from where the camera is now.
    guard following else {
      mapView.setZoomLevel(min(19, max(3, mapView.zoomLevel + delta)), animated: true)
      return
    }
    let now = mapView.camera
    let zoom: Double
    if navigating {
      let base = lastFrame?.zoom ?? mapView.zoomLevel
      zoomOffset = min(19, max(3, base + zoomOffset + delta)) - base
      zoom = base + zoomOffset
    } else {
      freeZoom = min(19, max(3, freeZoom + delta))
      zoom = freeZoom
    }
    now.altitude = altitude(zoom, pitch: now.pitch, at: now.centerCoordinate)
    move(now, duration: 0.3, timing: .easeOut)
  }

  func pan(_ direction: CGVector) {
    setFollowing(false)
    let size = mapView.bounds.size
    let centre = CGPoint(x: size.width / 2 + direction.dx * size.width / 3, y: size.height / 2 + direction.dy * size.height / 3)
    mapView.setCenter(mapView.convert(centre, toCoordinateFrom: mapView), animated: true)
  }

  /// The drag's last translation, so each update moves the map by what changed.
  private var dragged = CGPoint.zero

  func beginDrag() {
    setFollowing(false)
    dragged = .zero
  }

  func drag(to translation: CGPoint) {
    let dx = translation.x - dragged.x, dy = translation.y - dragged.y
    dragged = translation
    let size = mapView.bounds.size
    let centre = CGPoint(x: size.width / 2 - dx, y: size.height / 2 - dy)
    mapView.setCenter(mapView.convert(centre, toCoordinateFrom: mapView), animated: false)
  }

  private func setFollowing(_ on: Bool) {
    guard on != following else { return }
    following = on
    if !on {
      settleToken += 1
      settleUntil = nil
      pendingFrame = nil
      setSettled(false)
    }
    onFollowingChange?(on)
  }

  private func setSettled(_ on: Bool) {
    guard on != settled else { return }
    settled = on
    updateOverlay()
    drawLayers()
  }

  private func moved(to fix: CLLocation) {
    let now = Date()
    if let fixAt { gap = 0.7 * gap + 0.3 * min(2.5, max(0.4, now.timeIntervalSince(fixAt))) }
    fixAt = now
    here = fix
    drawLayers()
    updateOverlay()
    // Navigating, JS moves the camera (it has the route); without a trip, the glide is ours.
    if following && !navigating {
      if let until = settleUntil, now < until { return }
      if settled {
        move(freeCamera(), duration: gap * 1.3, timing: .linear)
      } else {
        settle(freeCamera(), duration: 1)
      }
    }
  }

  /// Moves to `camera`, then the overlay stands for the user; moves meanwhile wait for it.
  private func settle(_ camera: MLNMapCamera?, duration: Double) {
    guard let camera else { return }
    settleToken += 1
    let token = settleToken
    setSettled(false)
    settleUntil = Date().addingTimeInterval(duration)
    move(camera, duration: duration, timing: .easeInEaseOut)
    DispatchQueue.main.asyncAfter(deadline: .now() + duration) { [weak self] in
      guard let self, self.settleToken == token, self.following else { return }
      self.settleUntil = nil
      self.setSettled(true)
      if let next = self.pendingFrame {
        self.pendingFrame = nil
        self.move(self.navCamera(next), duration: Double(next.duration) / 1000, timing: .linear)
      } else if !self.navigating {
        self.move(self.freeCamera(), duration: self.gap * 1.3, timing: .linear)
      }
    }
  }

  /// The safe area changed while following: the same target with the new padding.
  private func refollow() {
    if navigating {
      if let lastFrame { move(navCamera(lastFrame), duration: 0.5, timing: .easeInEaseOut) }
    } else if let camera = freeCamera() {
      move(camera, duration: 0.5, timing: .easeInEaseOut)
    }
  }

  private func move(_ camera: MLNMapCamera?, duration: Double, timing: CAMediaTimingFunctionName) {
    guard isViewLoaded, let camera else { return }
    mapView.setCamera(
      camera, withDuration: duration, animationTimingFunction: CAMediaTimingFunction(name: timing),
      edgePadding: insets(), completionHandler: nil)
  }

  private func navCamera(_ c: CarCamera) -> MLNMapCamera {
    let centre = CLLocationCoordinate2D(latitude: c.lat, longitude: c.lon)
    let zoom = min(19, max(3, c.zoom + zoomOffset))
    let pitch = CGFloat(c.pitch)
    // Zoom and pitch in one camera: two animations side by side cancelled each other.
    return MLNMapCamera(
      lookingAtCenter: centre, altitude: altitude(zoom, pitch: pitch, at: centre), pitch: pitch,
      heading: c.bearing ?? mapView.camera.heading)
  }

  /// Without a trip: north up and flat, where the user will be at the next fix (as follow-core does
  /// off a route: straight on at their speed, at most 60 m).
  private func freeCamera() -> MLNMapCamera? {
    guard let here else { return nil }
    var centre = here.coordinate
    let ahead = here.speed >= 0.5 && here.course >= 0 ? min(60, here.speed * gap * 1.3) : 0
    if ahead > 0 {
      let b = here.course * .pi / 180
      centre.latitude += ahead * cos(b) / 111_320
      centre.longitude += ahead * sin(b) / (111_320 * cos(here.coordinate.latitude * .pi / 180))
    }
    return MLNMapCamera(lookingAtCenter: centre, altitude: altitude(freeZoom, pitch: 0, at: centre), pitch: 0, heading: 0)
  }

  private func altitude(_ zoom: Double, pitch: CGFloat, at centre: CLLocationCoordinate2D) -> CLLocationDistance {
    MLNAltitudeForZoomLevel(zoom, pitch, centre.latitude, mapView.bounds.size)
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

  // MARK: The user

  /// The overlay at the camera's centre (the padded one): the arrow navigating, the dot otherwise.
  private func placeOverlay() {
    guard isViewLoaded else { return }
    let i = insets()
    let size = view.bounds.size
    let centre = CGPoint(x: (i.left + size.width - i.right) / 2, y: (i.top + size.height - i.bottom) / 2)
    arrow.center = centre
    dot.center = centre
  }

  private func updateOverlay() {
    let show = following && settled && here != nil
    placeOverlay()
    arrow.isHidden = !(show && navigating)
    dot.isHidden = !(show && !navigating)
    if !arrow.isHidden {
      arrow.weak = isWeakFix()
      if weakTimer == nil {
        // No fix comes to say the signal is gone (a tunnel): looked at every couple of seconds.
        weakTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
          guard let self else { return }
          self.arrow.weak = self.isWeakFix()
        }
      }
    } else {
      weakTimer?.invalidate()
      weakTimer = nil
    }
  }

  /// follow-core's isWeakFix: a rough fix, or none for 10 s while moving.
  private func isWeakFix() -> Bool {
    guard let here else { return true }
    return here.horizontalAccuracy > 50 || (Date().timeIntervalSince(here.timestamp) > 10 && here.speed > 1)
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
    let ahead = navigating ? remainingRoute() : route
    // MapLibre throws on a polyline with no points (the style loads before any route).
    let line = ahead.count > 1 ? MLNPolylineFeature(coordinates: ahead, count: UInt(ahead.count)) : nil
    // The phone's route: yellow on a dark casing, the same widths.
    shape("car-route", line) { source in
      let casing = MLNLineStyleLayer(identifier: "car-route-casing", source: source)
      casing.lineColor = NSExpression(forConstantValue: CarColors.surface)
      casing.lineWidth = NSExpression(forConstantValue: 9)
      let fill = MLNLineStyleLayer(identifier: "car-route", source: source)
      fill.lineColor = NSExpression(forConstantValue: CarColors.accent)
      fill.lineWidth = NSExpression(forConstantValue: 5.5)
      for l in [casing, fill] {
        l.lineCap = NSExpression(forConstantValue: "round")
        l.lineJoin = NSExpression(forConstantValue: "round")
      }
      return [casing, fill]
    }
    // The phone's destination: a yellow dot inside a yellow ring.
    shape("car-destination", point(destination)) { source in
      let ring = MLNCircleStyleLayer(identifier: "car-destination-ring", source: source)
      ring.circleRadius = NSExpression(forConstantValue: 16)
      ring.circleOpacity = NSExpression(forConstantValue: 0)
      ring.circleStrokeColor = NSExpression(forConstantValue: CarColors.accent)
      ring.circleStrokeWidth = NSExpression(forConstantValue: 3)
      let dot = MLNCircleStyleLayer(identifier: "car-destination", source: source)
      dot.circleRadius = NSExpression(forConstantValue: 9)
      dot.circleColor = NSExpression(forConstantValue: CarColors.accent)
      dot.circleStrokeColor = NSExpression(forConstantValue: CarColors.surface)
      dot.circleStrokeWidth = NSExpression(forConstantValue: 3)
      return [ring, dot]
    }
    // The user as a layer only while the overlay doesn't stand for them (looking around, an overview).
    let overlay = following && settled
    shape("car-user", overlay ? nil : point(here?.coordinate)) { source in
      let halo = MLNCircleStyleLayer(identifier: "car-user-halo", source: source)
      halo.circleRadius = NSExpression(forConstantValue: 16)
      halo.circleColor = NSExpression(forConstantValue: CarColors.location.withAlphaComponent(0.2))
      halo.circlePitchAlignment = NSExpression(forConstantValue: "viewport")
      let dot = MLNCircleStyleLayer(identifier: "car-user", source: source)
      dot.circleRadius = NSExpression(forConstantValue: 8)
      dot.circleColor = NSExpression(forConstantValue: CarColors.location)
      dot.circleStrokeColor = NSExpression(forConstantValue: UIColor.white)
      dot.circleStrokeWidth = NSExpression(forConstantValue: 3)
      dot.circlePitchAlignment = NSExpression(forConstantValue: "viewport")
      return [halo, dot]
    }
  }

  /// What's left of the route while navigating: from where JS has the user on it (the phone's cut),
  /// else from the car's own fix projected onto it.
  private func remainingRoute() -> [CLLocationCoordinate2D] {
    if let cut, cut.segment + 1 < route.count {
      return [CLLocationCoordinate2D(latitude: cut.lat, longitude: cut.lon)] + route[(cut.segment + 1)...]
    }
    guard route.count > 1, let here else { return route }
    // The nearest segment, searched a little behind and ahead of the last one (a route can pass near itself).
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
    let from = max(0, min(routeSegment, route.count - 2) - 5), to = min(route.count - 2, routeSegment + 200)
    var best = (segment: from, point: route[from], d: Double.infinity)
    for i in from...to {
      let (q, d) = project(i)
      if d < best.d { best = (i, q, d) }
    }
    routeSegment = best.segment
    return [best.point] + route[(best.segment + 1)...]
  }

  // MARK: MLNMapViewDelegate

  func mapView(_ mapView: MLNMapView, didFinishLoading style: MLNStyle) {
    // A new style (a map installed, the language) has none of our layers.
    drawLayers()
  }

  func mapViewDidFailLoadingMap(_ mapView: MLNMapView, withError error: Error) {
    NSLog("[carplay] map failed to load: %@", error.localizedDescription)
  }
}

/// The phone's navigation arrow (lucide's Navigation2, as FollowArrow draws it): blue with a dark
/// edge, grey with a rough or lost fix. Always points up: the map turns with the car.
final class CarArrowView: UIView {
  private let shape = CAShapeLayer()

  var weak = false {
    didSet { if weak != oldValue { shape.fillColor = (weak ? CarColors.weak : CarColors.location).cgColor } }
  }

  override init(frame: CGRect) {
    super.init(frame: frame)
    backgroundColor = .clear
    // Lucide's 24-unit polygon: 12,2 19,21 12,17 5,21.
    let s = frame.width / 24
    let path = UIBezierPath()
    path.move(to: CGPoint(x: 12 * s, y: 2 * s))
    path.addLine(to: CGPoint(x: 19 * s, y: 21 * s))
    path.addLine(to: CGPoint(x: 12 * s, y: 17 * s))
    path.addLine(to: CGPoint(x: 5 * s, y: 21 * s))
    path.close()
    shape.path = path.cgPath
    shape.fillColor = CarColors.location.cgColor
    shape.strokeColor = CarColors.onAccent.cgColor
    shape.lineWidth = 1.6 * s
    shape.lineJoin = .round
    layer.addSublayer(shape)
    layer.shadowColor = UIColor.black.cgColor
    layer.shadowOpacity = 0.5
    layer.shadowRadius = 6
    layer.shadowOffset = CGSize(width: 0, height: 2)
  }

  required init?(coder: NSCoder) { fatalError("not used") }
}

/// The phone's location puck without a trip (MapLibre's, tinted with the location colour): a blue
/// dot with a white edge in a soft halo.
final class CarDotView: UIView {
  override init(frame: CGRect) {
    super.init(frame: frame)
    backgroundColor = .clear
    let halo = CALayer()
    halo.frame = bounds
    halo.cornerRadius = bounds.width / 2
    halo.backgroundColor = CarColors.location.withAlphaComponent(0.2).cgColor
    let side: CGFloat = 18
    let dot = CALayer()
    dot.frame = CGRect(x: (bounds.width - side) / 2, y: (bounds.height - side) / 2, width: side, height: side)
    dot.cornerRadius = side / 2
    dot.backgroundColor = CarColors.location.cgColor
    dot.borderColor = UIColor.white.cgColor
    dot.borderWidth = 3
    dot.shadowColor = UIColor.black.cgColor
    dot.shadowOpacity = 0.3
    dot.shadowRadius = 2
    dot.shadowOffset = CGSize(width: 0, height: 1)
    layer.addSublayer(halo)
    layer.addSublayer(dot)
  }

  required init?(coder: NSCoder) { fatalError("not used") }
}
