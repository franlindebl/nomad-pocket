// The map on the car's screen (CarMapViewController.swift's twin). Android Auto gives a navigation app
// a Surface to draw on, not a view: a VirtualDisplay on that surface shows a Presentation holding a
// MapLibre MapView, with the style JS builds for the phone (the same offline PMTiles, glyphs and
// sprites), the route line, the destination and the user's position. The host draws its templates
// (buttons, maneuver card) on top, so the camera keeps the user inside the visible area it reports.
// Following: course up and tilted while navigating, north up otherwise; a pan stops following until
// "recentre" (a zoom doesn't). Position and camera are ours, from the platform's LocationManager.
package expo.modules.nomadcarplay

import android.annotation.SuppressLint
import android.app.Presentation
import android.content.Context
import android.graphics.Point as ScreenPoint
import android.graphics.Rect
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Looper
import android.util.Log
import androidx.car.app.CarContext
import androidx.car.app.SurfaceCallback
import androidx.car.app.SurfaceContainer
import org.maplibre.android.MapLibre
import org.maplibre.android.camera.CameraPosition
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.geometry.LatLngBounds
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.MapLibreMapOptions
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.Style
import org.maplibre.android.style.expressions.Expression
import org.maplibre.android.style.layers.CircleLayer
import org.maplibre.android.style.layers.LineLayer
import org.maplibre.android.style.layers.Property
import org.maplibre.android.style.layers.PropertyFactory
import org.maplibre.android.style.sources.GeoJsonSource
import org.maplibre.geojson.Feature
import org.maplibre.geojson.LineString
import org.maplibre.geojson.Point
import kotlin.math.cos
import kotlin.math.ln
import kotlin.math.max
import kotlin.math.min

class CarMap(private val car: CarContext) : SurfaceCallback {
  private val tag = "NomadCar"
  private var display: VirtualDisplay? = null
  private var presentation: Presentation? = null
  private var mapView: MapView? = null
  private var map: MapLibreMap? = null

  private var styles: Pair<String, String>? = null
  private var appliedStyle: String? = null
  private var route: List<LatLng> = emptyList()
  private var routeSegment = 0
  private var destination: LatLng? = null
  private var here: Location? = null
  private var course = 0.0
  private var navigating = false
  private var visible: Rect? = null
  /** The trip whose whole route is framed (the preview): framed again when the surface or the style comes back. */
  private var overview: CarTarget? = null
  private var size = Rect()

  /** Where the user is, as the car map last knew it. */
  val position: LatLng?
    get() = here?.let { LatLng(it.latitude, it.longitude) }

  /** Following the user (false after a pan or an overview). */
  var following = true
    private set
  var onFollowingChange: ((Boolean) -> Unit)? = null

  // MARK: Surface

  override fun onSurfaceAvailable(container: SurfaceContainer) {
    val surface = container.surface ?: return
    release()
    size = Rect(0, 0, container.width, container.height)
    MapLibre.getInstance(car.applicationContext)
    val dm = car.getSystemService(DisplayManager::class.java)
    val vd =
      dm.createVirtualDisplay("NomadCarMap", container.width, container.height, container.dpi, surface, DisplayManager.VIRTUAL_DISPLAY_FLAG_OWN_CONTENT_ONLY)
    display = vd
    val p = Presentation(car, vd.display)
    val view = MapView(p.context, MapLibreMapOptions.createFromAttributes(p.context).textureMode(false))
    p.setContentView(view)
    view.onCreate(null)
    view.onStart()
    view.onResume()
    p.show()
    presentation = p
    mapView = view
    view.getMapAsync { m ->
      map = m
      m.uiSettings.isLogoEnabled = false
      m.uiSettings.isAttributionEnabled = false
      m.uiSettings.isCompassEnabled = false
      // MapLibre's default style is a demo map from the internet: never. A plain background until JS
      // sends the offline style.
      applyStyle(force = true)
      // Street level from the start (the camera follows the user at whatever zoom it has).
      m.moveCamera(CameraUpdateFactory.zoomTo(15.0))
      here?.let { m.moveCamera(CameraUpdateFactory.newLatLngZoom(LatLng(it.latitude, it.longitude), 15.0)) }
    }
    startLocation()
  }

  override fun onVisibleAreaChanged(visibleArea: Rect) {
    // The maneuver card or the action strip came or went: the user stays in the free part.
    visible = Rect(visibleArea)
    if (following) follow(true)
  }

  override fun onSurfaceDestroyed(container: SurfaceContainer) {
    release()
  }

  override fun onScroll(distanceX: Float, distanceY: Float) {
    overview = null
    setFollowing(false)
    map?.scrollBy(-distanceX, -distanceY, 0)
  }

  override fun onScale(focusX: Float, focusY: Float, scaleFactor: Float) {
    val m = map ?: return
    val delta = ln(scaleFactor.toDouble()) / ln(2.0)
    // A double tap comes with focus -1, -1: zoom on the centre (keeps following).
    if (focusX < 0 || focusY < 0) zoom(delta) else m.moveCamera(CameraUpdateFactory.zoomBy(delta, ScreenPoint(focusX.toInt(), focusY.toInt())))
  }

  private fun release() {
    stopLocation()
    mapView?.apply {
      onPause()
      onStop()
      onDestroy()
    }
    presentation?.dismiss()
    display?.release()
    mapView = null
    map = null
    presentation = null
    display = null
    appliedStyle = null
  }

  fun destroy() = release()

  // MARK: Content

  fun setStyles(light: String, dark: String) {
    styles = light to dark
    applyStyle()
  }

  /** Day and night follow the car (its headlights or its setting), not the phone. */
  fun onDarkModeChanged() = applyStyle()

  private fun applyStyle(force: Boolean = false) {
    val m = map ?: return
    val json =
      styles?.let { if (car.isDarkMode) it.second else it.first }
        ?: """{"version":8,"sources":{},"layers":[{"id":"background","type":"background","paint":{"background-color":"#d9d6cf"}}]}"""
    if (!force && json == appliedStyle) return
    appliedStyle = json
    m.setStyle(Style.Builder().fromJson(json)) {
      // A new style has none of our layers.
      drawLayers()
      if (following) follow(false) else overview?.let { showOverview(it) }
    }
  }

  fun setRoute(shape: List<DoubleArray>) {
    route = shape.map { LatLng(it[1], it[0]) }
    routeSegment = 0
    drawLayers()
  }

  fun setDestination(target: CarTarget?) {
    val next = target?.let { LatLng(it.lat, it.lon) }
    if (next == destination) return
    destination = next
    drawLayers()
    // The trip is over (ended, cancelled): back to following the driver.
    if (next == null) recentre()
  }

  fun setNavigating(on: Boolean) {
    if (on == navigating) return
    navigating = on
    if (on) setFollowing(true)
    drawLayers()
    if (following) follow(true)
  }

  /** The whole route (or the straight line to the target), above the trip preview. */
  fun showOverview(target: CarTarget) {
    overview = target
    setFollowing(false)
    val m = map ?: return
    val points = route.ifEmpty { listOfNotNull(LatLng(target.lat, target.lon), position) }
    if (points.size < 2) {
      m.animateCamera(CameraUpdateFactory.newLatLngZoom(points[0], 14.0))
      return
    }
    val pad = padding()
    m.moveCamera(CameraUpdateFactory.newCameraPosition(CameraPosition.Builder(m.cameraPosition).tilt(0.0).bearing(0.0).build()))
    m.animateCamera(
      CameraUpdateFactory.newLatLngBounds(
        LatLngBounds.Builder().includes(points).build(),
        pad[0].toInt() + 24,
        pad[1].toInt() + 24,
        pad[2].toInt() + 24,
        pad[3].toInt() + 24,
      ),
    )
  }

  // MARK: Camera

  fun recentre() {
    setFollowing(true)
    val m = map ?: return
    // Back from a trip's overview: street level again.
    if (!navigating && m.cameraPosition.zoom < 13) m.moveCamera(CameraUpdateFactory.zoomTo(15.0))
    follow(true)
  }

  fun zoom(delta: Double) {
    val m = map ?: return
    // A zoom keeps following, as in CarPlay: only the distance changes.
    m.animateCamera(CameraUpdateFactory.zoomTo(min(19.0, max(3.0, m.cameraPosition.zoom + delta))))
  }

  private fun setFollowing(on: Boolean) {
    if (on) overview = null
    if (on == following) return
    following = on
    onFollowingChange?.invoke(on)
  }

  private fun moved(fix: Location) {
    here = fix
    if (fix.hasSpeed() && fix.speed > 2 && fix.hasBearing()) course = fix.bearing.toDouble()
    drawLayers()
    if (following) follow(true)
  }

  /** The camera on the user: course up and tilted while navigating, north up and flat otherwise. */
  private fun follow(animated: Boolean) {
    val m = map ?: return
    val fix = here ?: return
    val zoom = if (navigating && m.cameraPosition.zoom < 14) 16.0 else m.cameraPosition.zoom
    val pad = padding()
    val camera =
      CameraPosition.Builder()
        .target(LatLng(fix.latitude, fix.longitude))
        .zoom(zoom)
        .bearing(if (navigating) course else 0.0)
        .tilt(if (navigating) 45.0 else 0.0)
        .padding(pad[0], pad[1], pad[2], pad[3])
        .build()
    val update = CameraUpdateFactory.newCameraPosition(camera)
    if (animated) m.animateCamera(update, 800) else m.moveCamera(update)
  }

  /** left, top, right, bottom: outside the host's visible area, and low on the screen while navigating. */
  private fun padding(): DoubleArray {
    val v = visible ?: size
    val left = v.left.toDouble()
    val right = (size.width() - v.right).toDouble().coerceAtLeast(0.0)
    val bottom = (size.height() - v.bottom).toDouble().coerceAtLeast(0.0)
    var top = v.top.toDouble()
    if (navigating && following) top += max(0.0, v.height() * 0.35)
    return doubleArrayOf(left, top, right, bottom)
  }

  // MARK: Location

  private val listener = LocationListener { moved(it) }

  @SuppressLint("MissingPermission")
  private fun startLocation() {
    val lm = car.getSystemService(LocationManager::class.java) ?: return
    try {
      // Until the first fix: where the phone last was, not 0, 0 in the ocean.
      if (here == null) {
        here =
          listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
            .mapNotNull { runCatching { lm.getLastKnownLocation(it) }.getOrNull() }
            .maxByOrNull { it.time }
      }
      lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000L, 0f, listener, Looper.getMainLooper())
    } catch (e: SecurityException) {
      // No location permission yet: the phone app asks for it.
      Log.w(tag, "no location permission", e)
    } catch (e: IllegalArgumentException) {
      Log.w(tag, "no GPS provider", e)
    }
  }

  private fun stopLocation() {
    car.getSystemService(LocationManager::class.java)?.removeUpdates(listener)
  }

  // MARK: Layers

  private fun source(style: Style, id: String, feature: Feature?, layers: (String) -> List<org.maplibre.android.style.layers.Layer>) {
    val existing = style.getSourceAs<GeoJsonSource>(id)
    if (existing != null) {
      if (feature != null) existing.setGeoJson(feature) else existing.setGeoJson(org.maplibre.geojson.FeatureCollection.fromFeatures(emptyList()))
      return
    }
    val src = if (feature != null) GeoJsonSource(id, feature) else GeoJsonSource(id)
    style.addSource(src)
    layers(id).forEach { style.addLayer(it) }
  }

  private fun point(p: LatLng?) = p?.let { Feature.fromGeometry(Point.fromLngLat(it.longitude, it.latitude)) }

  private fun drawLayers() {
    val style = map?.style ?: return
    if (!style.isFullyLoaded) return
    val blue = "#2E80FA"
    val ahead = if (navigating) remainingRoute() else route
    val line = if (ahead.size > 1) Feature.fromGeometry(LineString.fromLngLats(ahead.map { Point.fromLngLat(it.longitude, it.latitude) })) else null
    source(style, "car-route", line) { id ->
      val width = { a: Float, b: Float -> Expression.interpolate(Expression.exponential(1.5f), Expression.zoom(), Expression.stop(10, a), Expression.stop(18, b)) }
      listOf(
        LineLayer("car-route-casing", id).withProperties(
          PropertyFactory.lineColor("#0D4099"),
          PropertyFactory.lineWidth(width(5f, 22f)),
          PropertyFactory.lineCap(Property.LINE_CAP_ROUND),
          PropertyFactory.lineJoin(Property.LINE_JOIN_ROUND),
        ),
        LineLayer("car-route", id).withProperties(
          PropertyFactory.lineColor(blue),
          PropertyFactory.lineWidth(width(3f, 16f)),
          PropertyFactory.lineCap(Property.LINE_CAP_ROUND),
          PropertyFactory.lineJoin(Property.LINE_JOIN_ROUND),
        ),
      )
    }
    source(style, "car-destination", point(destination)) { id ->
      listOf(
        CircleLayer("car-destination", id).withProperties(
          PropertyFactory.circleRadius(9f),
          PropertyFactory.circleColor("#E63333"),
          PropertyFactory.circleStrokeColor("#FFFFFF"),
          PropertyFactory.circleStrokeWidth(3f),
        ),
      )
    }
    source(style, "car-user", point(position)) { id ->
      listOf(
        CircleLayer("car-user-halo", id).withProperties(
          PropertyFactory.circleRadius(16f),
          PropertyFactory.circleColor("#332E80FA"),
          PropertyFactory.circlePitchAlignment(Property.CIRCLE_PITCH_ALIGNMENT_VIEWPORT),
        ),
        CircleLayer("car-user", id).withProperties(
          PropertyFactory.circleRadius(8f),
          PropertyFactory.circleColor(blue),
          PropertyFactory.circleStrokeColor("#FFFFFF"),
          PropertyFactory.circleStrokeWidth(3f),
          PropertyFactory.circlePitchAlignment(Property.CIRCLE_PITCH_ALIGNMENT_VIEWPORT),
        ),
      )
    }
  }

  /** The route from the user's position on it (the iOS twin's search: a little behind, further ahead). */
  private fun remainingRoute(): List<LatLng> {
    val p = position ?: return route
    if (route.size < 2) return route
    val k = cos(Math.toRadians(p.latitude))
    var best = Triple(routeSegment, route[routeSegment], Double.MAX_VALUE)
    for (i in max(0, routeSegment - 5)..min(route.size - 2, routeSegment + 200)) {
      val a = route[i]
      val b = route[i + 1]
      val ax = (a.longitude - p.longitude) * k
      val ay = a.latitude - p.latitude
      val dx = (b.longitude - p.longitude) * k - ax
      val dy = b.latitude - p.latitude - ay
      val len = dx * dx + dy * dy
      val t = if (len > 0) max(0.0, min(1.0, -(ax * dx + ay * dy) / len)) else 0.0
      val x = ax + t * dx
      val y = ay + t * dy
      val d = x * x + y * y
      if (d < best.third) best = Triple(i, LatLng(a.latitude + t * (b.latitude - a.latitude), a.longitude + t * (b.longitude - a.longitude)), d)
    }
    routeSegment = best.first
    return listOf(best.second) + route.subList(best.first + 1, route.size)
  }
}
