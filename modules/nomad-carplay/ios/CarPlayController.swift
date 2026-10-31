// The car's templates around the map: a map template with pan / zoom / recentre buttons and
// "Destinos" (search, saved places, emergency points nearby); a destination chosen in the car goes
// to JS, which starts guidance as on the phone; once the route is there, the trip preview with
// its time and distance and "Ir"; then a navigation session whose maneuver panel and estimates
// follow what JS reports. A trip started on the phone shows in the car straight away, and ending
// it on either side ends it on both: there is one guidance, in JS.
import CarPlay
import MapKit
import UIKit

final class CarPlayController: NSObject, CPMapTemplateDelegate, CPSearchTemplateDelegate {
  let interface: CPInterfaceController
  let map: CarMapViewController
  private let mapTemplate = CPMapTemplate()
  private var strings: CarStrings?
  private var guidance: CarGuidance?

  private var trip: CPTrip?
  private var tripTarget: CarTarget?
  private var previewing = false
  private var session: CPNavigationSession?
  /// What the panel shows: (route, maneuver, the one after or -1), so a change redraws it.
  private var shown: (route: Int, index: Int, then: Int)?
  private var maneuver: CPManeuver?
  private var paused = false
  /// The trip that reached its destination (no new session for it).
  private var finished: CarTarget?

  private lazy var recentreButton = mapButton("location.fill") { [weak self] in self?.map.recentre() }

  init(interface: CPInterfaceController, window: CPWindow) {
    self.interface = interface
    map = CarMapViewController()
    super.init()
    window.rootViewController = map
    mapTemplate.mapDelegate = self
    mapTemplate.guidanceBackgroundColor = UIColor(red: 0.07, green: 0.2, blue: 0.4, alpha: 1)
    mapTemplate.tripEstimateStyle = .dark
    // The bar and the map buttons stay: "Terminar" one tap away while driving (with the bar
    // hiding by itself it took two, and in the simulator a tap on it while it showed only hid it).
    mapTemplate.hidesButtonsWithNavigationBar = false
    mapTemplate.automaticallyHidesNavigationBar = false
    map.onFollowingChange = { [weak self] following in self?.recentreButton.isHidden = following }
    mapTemplate.mapButtons = [
      recentreButton,
      mapButton("plus.magnifyingglass") { [weak self] in self?.map.zoom(by: 1) },
      mapButton("minus.magnifyingglass") { [weak self] in self?.map.zoom(by: -1) },
      mapButton("arrow.up.and.down.and.arrow.left.and.right") { [weak self] in
        self?.mapTemplate.showPanningInterface(animated: true)
      },
    ]
    // After the buttons are on the template: set before, CarPlay showed it anyway.
    recentreButton.isHidden = map.following
    interface.setRootTemplate(mapTemplate, animated: false, completion: Self.logged)
  }

  func disconnect() {
    // The car went away mid-trip: guidance goes on on the phone.
    session = nil
    trip = nil
  }

  // MARK: From JS

  func apply(strings s: CarStrings) {
    strings = s
    bars = nil
    updateBarButtons()
  }

  func apply(guidance g: CarGuidance) {
    let previous = guidance
    guidance = g
    map.setDestination(g.target)
    map.setNavigating(g.navigating)

    guard let target = g.target else {
      if hasTrip { endTrip(arrived: previous?.arrived ?? false) }
      updateBarButtons()
      return
    }
    if let tripTarget, tripTarget != target { endTrip(arrived: false) }
    // A new trip (from the phone, or picked in a list): back to the map, where its preview is.
    if previous?.target != target && interface.templates.count > 1 { interface.popToRootTemplate(animated: true, completion: Self.logged) }
    if let finished, finished != target { self.finished = nil }

    if g.navigating {
      if previewing { hidePreview() }
      // Arrived: the session ends; guidance itself ends a minute later (or on "Finalizar").
      if g.arrived {
        if session != nil {
          endTrip(arrived: true)
          announceArrival(at: target)
        }
        finished = target
      } else {
        if session == nil && finished != target { startSession(for: target) }
        updateSession(g)
      }
    } else if g.routing != "loading" {
      // The route (or the straight line) is known: the preview, once per target and route.
      if !previewing || previous?.routeId != g.routeId { showPreview(for: target, g) }
    }
    updateBarButtons()
  }

  func alert(_ message: String, button: String) {
    let ok = CPAlertAction(title: button, style: .cancel) { [weak self] _ in
      self?.interface.dismissTemplate(animated: true, completion: Self.logged)
    }
    interface.presentTemplate(CPAlertTemplate(titleVariants: [message], actions: [ok]), animated: true, completion: Self.logged)
  }

  // MARK: Trip preview

  private func makeTrip(to target: CarTarget) -> CPTrip {
    let destination = MKMapItem(placemark: MKPlacemark(coordinate: CLLocationCoordinate2D(latitude: target.lat, longitude: target.lon)))
    destination.name = target.name
    let summary = guidance?.note ?? (guidance?.routing == "ready" ? "" : strings?.straightLine ?? "")
    let choice = CPRouteChoice(summaryVariants: [summary], additionalInformationVariants: [], selectionSummaryVariants: [summary])
    let trip = CPTrip(origin: MKMapItem.forCurrentLocation(), destination: destination, routeChoices: [choice])
    tripTarget = target
    return trip
  }

  private func showPreview(for target: CarTarget, _ g: CarGuidance) {
    let trip = makeTrip(to: target)
    self.trip = trip
    let text = CPTripPreviewTextConfiguration(startButtonTitle: strings?.go, additionalRoutesButtonTitle: nil, overviewButtonTitle: nil)
    mapTemplate.showTripPreviews([trip], textConfiguration: text)
    if let summary = g.summary { mapTemplate.update(estimates(summary), for: trip, with: .default) }
    previewing = true
    // Once the preview card is up: the map's safe area then leaves it out.
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
      if self?.previewing == true { self?.map.showOverview(of: target) }
    }
  }

  private func hidePreview() {
    mapTemplate.hideTripPreviews()
    previewing = false
  }

  // MARK: Navigation session

  private func startSession(for target: CarTarget) {
    let trip = self.trip ?? makeTrip(to: target)
    self.trip = trip
    session = mapTemplate.startNavigationSession(for: trip)
    shown = nil
    paused = false
    map.recentre()
  }

  private func updateSession(_ g: CarGuidance) {
    guard let session, let trip else { return }
    // A reroute in progress: the panel says so until the new route comes.
    if g.routing == "loading" {
      if !paused {
        session.pauseTrip(for: .rerouting, description: strings?.rerouting)
        paused = true
      }
      return
    }
    guard let step = g.step else { return }
    let then = g.nextStep?.index ?? -1
    if shown?.route != g.routeId || shown?.index != step.index || shown?.then != then || paused {
      let first = makeManeuver(step)
      var upcoming = [first]
      if let next = g.nextStep { upcoming.append(makeManeuver(next)) }
      session.upcomingManeuvers = upcoming
      maneuver = first
      shown = (g.routeId, step.index, then)
      paused = false
    } else if let maneuver {
      session.updateEstimates(estimates(step.estimate), for: maneuver)
    }
    if let remaining = g.remaining { mapTemplate.update(estimates(remaining), for: trip, with: .default) }
  }

  private var hasTrip: Bool { session != nil || previewing || trip != nil }

  private func endTrip(arrived: Bool) {
    if let session {
      if arrived { session.finishTrip() } else { session.cancelTrip() }
    }
    session = nil
    maneuver = nil
    shown = nil
    if previewing { hidePreview() }
    trip = nil
    tripTarget = nil
    map.recentre()
  }

  /// "Has llegado" over the map for a while; its button ends guidance now (else it ends by itself a
  /// minute after arriving, as on the phone).
  private func announceArrival(at target: CarTarget) {
    guard let strings else { return }
    let end = CPAlertAction(title: strings.end, style: .default) { _ in CarPlayHub.shared.emit("onEnd") }
    let alert = CPNavigationAlert(
      titleVariants: [strings.arrived], subtitleVariants: [target.name], image: UIImage(systemName: "flag.checkered"),
      primaryAction: end, secondaryAction: nil, duration: 10)
    mapTemplate.present(navigationAlert: alert, animated: true)
  }

  private func makeManeuver(_ step: CarStep) -> CPManeuver {
    let m = CPManeuver()
    var variants = [step.instruction]
    if let street = step.street, !street.isEmpty, street != step.instruction { variants.append(street) }
    m.instructionVariants = variants
    m.symbolImage = symbol(for: step.icon, rotation: step.rotation ?? 0)
    m.initialTravelEstimates = estimates(step.estimate)
    return m
  }

  // MARK: Destinations

  /// What the bar buttons were made for: rebuilt only when it changes, not on every fix.
  private var bars: (navigating: Bool, target: Bool)?

  private func updateBarButtons() {
    guard let strings else { return }
    let state = (navigating: guidance?.navigating == true, target: guidance?.target != nil)
    if let bars, bars == state { return }
    bars = state
    let destinations = CPBarButton(title: strings.destinations) { [weak self] _ in self?.showDestinations() }
    mapTemplate.leadingNavigationBarButtons = guidance?.navigating == true ? [] : [destinations]
    if guidance?.target != nil {
      let title = guidance?.navigating == true ? strings.end : strings.cancel
      mapTemplate.trailingNavigationBarButtons = [CPBarButton(title: title) { _ in CarPlayHub.shared.emit("onEnd") }]
    } else {
      mapTemplate.trailingNavigationBarButtons = []
    }
  }

  private func showDestinations() {
    guard let strings else { return }
    var items: [CPListItem] = []
    let search = CPListItem(text: strings.search, detailText: nil, image: UIImage(systemName: "magnifyingglass"))
    search.handler = { [weak self] _, done in
      self?.showSearch()
      done()
    }
    items.append(search)
    let saved = CPListItem(text: strings.saved, detailText: nil, image: UIImage(systemName: "mappin"))
    saved.accessoryType = .disclosureIndicator
    saved.handler = { [weak self] _, done in
      CarPlayHub.shared.request("saved") { results in
        self?.pushResults(title: strings.saved, results, empty: strings.savedEmpty)
        done()
      }
    }
    items.append(saved)
    var nearby: [CPListItem] = []
    for pair in strings.categories where pair.count == 2 {
      let (id, label) = (pair[0], pair[1])
      let item = CPListItem(text: label, detailText: nil, image: UIImage(systemName: categoryIcon(id)))
      item.accessoryType = .disclosureIndicator
      item.handler = { [weak self] _, done in
        CarPlayHub.shared.request("emergency", ["category": id]) { results in
          self?.pushResults(title: label, results, empty: strings.emergencyEmpty)
          done()
        }
      }
      nearby.append(item)
    }
    let list = CPListTemplate(
      title: strings.destinations,
      sections: [CPListSection(items: items), CPListSection(items: nearby, header: strings.emergency, sectionIndexTitle: nil)]
    )
    interface.pushTemplate(list, animated: true, completion: Self.logged)
  }

  private func pushResults(title: String, _ results: [CarItem], empty: String) {
    let items = results.prefix(CPListTemplate.maximumItemCount).map(listItem)
    let list = CPListTemplate(title: title, sections: [CPListSection(items: Array(items))])
    if items.isEmpty { list.emptyViewSubtitleVariants = [empty] }
    interface.pushTemplate(list, animated: true, completion: Self.logged)
  }

  private func listItem(_ r: CarItem) -> CPListItem {
    let item = CPListItem(text: r.title, detailText: r.detail)
    item.userInfo = r
    item.handler = { [weak self] _, done in
      self?.pick(r)
      done()
    }
    return item
  }

  private func pick(_ r: CarItem) {
    CarPlayHub.shared.emit("onPick", ["name": r.title, "lat": r.lat, "lon": r.lon])
    interface.popToRootTemplate(animated: true, completion: Self.logged)
  }

  private func showSearch() {
    let search = CPSearchTemplate()
    search.delegate = self
    interface.pushTemplate(search, animated: true, completion: Self.logged)
  }

  func searchTemplate(_ searchTemplate: CPSearchTemplate, updatedSearchText searchText: String, completionHandler: @escaping ([CPListItem]) -> Void) {
    let text = searchText.trimmingCharacters(in: .whitespaces)
    guard text.count >= 2 else { return completionHandler([]) }
    CarPlayHub.shared.request("search", ["query": text]) { [weak self] results in
      guard let self else { return completionHandler([]) }
      completionHandler(results.prefix(CPListTemplate.maximumItemCount).map(self.listItem))
    }
  }

  func searchTemplate(_ searchTemplate: CPSearchTemplate, selectedResult item: CPListItem, completionHandler: @escaping () -> Void) {
    if let r = item.userInfo as? CarItem { pick(r) }
    completionHandler()
  }

  // MARK: CPMapTemplateDelegate

  func mapTemplate(_ mapTemplate: CPMapTemplate, startedTrip trip: CPTrip, using routeChoice: CPRouteChoice) {
    hidePreview()
    if let target = tripTarget { startSession(for: target) }
    CarPlayHub.shared.emit("onStart")
  }

  func mapTemplate(_ mapTemplate: CPMapTemplate, panWith direction: CPMapTemplate.PanDirection) {
    var v = CGVector.zero
    if direction.contains(.left) { v.dx -= 1 }
    if direction.contains(.right) { v.dx += 1 }
    if direction.contains(.up) { v.dy -= 1 }
    if direction.contains(.down) { v.dy += 1 }
    map.pan(v)
  }

  func mapTemplateDidCancelNavigation(_ mapTemplate: CPMapTemplate) {
    // The system ended it (another app started navigating): so does the app.
    session = nil
    CarPlayHub.shared.emit("onEnd")
  }

  func mapTemplate(_ mapTemplate: CPMapTemplate, displayStyleFor maneuver: CPManeuver) -> CPManeuverDisplayStyle {
    .leadingSymbol
  }

  // MARK: Helpers

  /// CarPlay raises an exception when a template call fails and no completion handler was passed
  /// (a pop with nothing to pop killed the app): every call gets this one.
  private static let logged: (Bool, Error?) -> Void = { _, error in
    if let error { NSLog("[carplay] template call failed: %@", error.localizedDescription) }
  }

  private func mapButton(_ symbol: String, _ action: @escaping () -> Void) -> CPMapButton {
    let button = CPMapButton { _ in action() }
    button.image = UIImage(systemName: symbol)
    return button
  }

  private func estimates(_ e: CarEstimate) -> CPTravelEstimates {
    CPTravelEstimates(distanceRemaining: e.distance.measurement, timeRemaining: e.seconds)
  }

  /// routing-core's ManeuverIcon as an SF Symbol, white on the panel; the straight-line arrow turned
  /// toward the target.
  private func symbol(for icon: String, rotation: Double = 0) -> UIImage? {
    let names: [String: String] = [
      "start": "location.north.line.fill",
      "arrive": "flag.checkered",
      "straight": "arrow.up",
      "slightRight": "arrow.up.right",
      "right": "arrow.turn.up.right",
      "sharpRight": "arrow.turn.down.right",
      "slightLeft": "arrow.up.left",
      "left": "arrow.turn.up.left",
      "sharpLeft": "arrow.turn.down.left",
      "uturn": "arrow.uturn.down",
      "roundabout": "arrow.triangle.turn.up.right.circle",
      "merge": "arrow.merge",
      "ferry": "ferry",
      "straight-line": "location.north.fill",
    ]
    let config = UIImage.SymbolConfiguration(pointSize: 48, weight: .semibold)
    let image = UIImage(systemName: names[icon] ?? "arrow.up", withConfiguration: config) ?? UIImage(systemName: "arrow.up", withConfiguration: config)
    guard let white = image?.withTintColor(.white, renderingMode: .alwaysOriginal) else { return nil }
    // Always drawn into a bitmap: CarPlay tinted some symbol images blue and left others white.
    // Turned inside a square canvas, so a diagonal arrow isn't clipped.
    let side = max(white.size.width, white.size.height)
    let format = UIGraphicsImageRendererFormat()
    format.scale = 3
    return UIGraphicsImageRenderer(size: CGSize(width: side, height: side), format: format).image { ctx in
      ctx.cgContext.translateBy(x: side / 2, y: side / 2)
      ctx.cgContext.rotate(by: rotation * .pi / 180)
      white.draw(in: CGRect(x: -white.size.width / 2, y: -white.size.height / 2, width: white.size.width, height: white.size.height))
    }
  }

  private func categoryIcon(_ id: String) -> String {
    switch id {
    case "health": return "cross.case"
    case "security": return "shield"
    case "water": return "drop"
    case "supplies": return "fuelpump"
    default: return "building.columns"
    }
  }
}
