// Android Auto's entry point (navigation category, AndroidManifest.xml): the host binds this service
// when the car shows the app, and each car connection is a Session (CarPlaySceneDelegate.swift's twin).
// The session owns the car's map (CarMap on the host's surface) and the screens; what JS last sent
// reaches it through CarHub.
package expo.modules.nomadcarplay

import android.content.Intent
import android.net.Uri
import android.content.res.Configuration
import android.content.pm.ApplicationInfo
import androidx.car.app.AppManager
import androidx.car.app.CarAppService
import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.Session
import androidx.car.app.navigation.NavigationManager
import androidx.car.app.navigation.NavigationManagerCallback
import androidx.car.app.navigation.model.Destination
import androidx.car.app.navigation.model.Trip
import androidx.car.app.validation.HostValidator
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner

class NomadCarAppService : CarAppService() {
  override fun createHostValidator(): HostValidator =
    // Debug builds talk to the Desktop Head Unit; a release only to the hosts Google signs (Android
    // Auto, Android Automotive), as the library's sample allowlist lists them.
    if (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) {
      HostValidator.ALLOW_ALL_HOSTS_VALIDATOR
    } else {
      HostValidator.Builder(applicationContext).addAllowedHosts(androidx.car.app.R.array.hosts_allowlist_sample).build()
    }

  override fun onCreateSession(): Session = NomadCarSession()
}

class NomadCarSession : Session() {
  var map: CarMap? = null
    private set
  private var root: MapScreen? = null
  private var navigationStarted = false

  init {
    lifecycle.addObserver(
      object : DefaultLifecycleObserver {
        override fun onDestroy(owner: LifecycleOwner) {
          if (navigationStarted) runCatching { navigation().navigationEnded() }
          navigationStarted = false
          map?.destroy()
          map = null
          if (CarHub.session === this@NomadCarSession) CarHub.session = null
          CarHub.emit("onDisconnect")
          CarJs.stop()
        }
      },
    )
  }

  private fun navigation() = carContext.getCarService(NavigationManager::class.java)

  override fun onCreateScreen(intent: Intent): Screen {
    val m = CarMap(carContext)
    map = m
    carContext.getCarService(AppManager::class.java).setSurfaceCallback(m)
    // Ended from the car's own controls (or another app took over navigation): the trip ends in JS.
    navigation().setNavigationManagerCallback(
      object : NavigationManagerCallback {
        override fun onStopNavigation() {
          navigationStarted = false
          CarHub.emit("onEnd")
        }
      },
    )
    val screen = MapScreen(carContext, m)
    root = screen
    m.onFollowingChange = { screen.invalidate() }
    CarHub.session = this
    CarHub.emit("onConnect")
    // Opened from the car with the app not running: its JS starts here (CarJs).
    CarJs.start(carContext)
    navigate(intent)
    return screen
  }

  override fun onNewIntent(intent: Intent) {
    navigate(intent)
  }

  /**
   * A destination from elsewhere (the car's assistant, a contact's address, another app): `geo:lat,lon`, or
   * `geo:0,0?q=lat,lon(Name)` or `?q=an address`. Coordinates start the trip as a pick in Destinos does; text
   * opens the search with it.
   */
  private fun navigate(intent: Intent) {
    if (intent.action != CarContext.ACTION_NAVIGATE) return
    val part = intent.data?.schemeSpecificPart ?: return
    val coords = part.substringBefore('?')
    val query = part.substringAfter('?', "").split('&').firstOrNull { it.startsWith("q=") }?.removePrefix("q=")?.let { Uri.decode(it) }?.trim()
    val fromQuery = query?.let { GEO_POINT.find(it) }
    val fromCoords = GEO_POINT.find(coords)?.takeIf { it.groupValues[1].toDouble() != 0.0 || it.groupValues[2].toDouble() != 0.0 }
    val hit = fromQuery ?: fromCoords
    if (hit != null) {
      val lat = hit.groupValues[1].toDouble()
      val lon = hit.groupValues[2].toDouble()
      val name = hit.groupValues.getOrNull(3)?.takeIf { it.isNotBlank() } ?: "%.5f, %.5f".format(java.util.Locale.ROOT, lat, lon)
      root?.screenManager?.popToRoot()
      CarHub.emit("onPick", mapOf("name" to name, "lat" to lat, "lon" to lon))
    } else if (!query.isNullOrBlank()) {
      root?.let { it.screenManager.push(SearchScreen(carContext, initial = query)) }
    }
  }

  override fun onCarConfigurationChanged(newConfiguration: Configuration) {
    map?.onDarkModeChanged()
  }

  fun apply(strings: CarStrings) {
    root?.invalidate()
  }

  fun apply(guidance: CarGuidance) {
    val m = map
    m?.setDestination(guidance.target)
    m?.setNavigating(guidance.navigating)
    // Tell the host a trip runs (the cluster and other apps' audio follow it).
    if (guidance.navigating != navigationStarted) {
      navigationStarted = guidance.navigating
      runCatching { if (guidance.navigating) navigation().navigationStarted() else navigation().navigationEnded() }
    }
    if (navigationStarted) trip(guidance)
    root?.show(guidance)
  }

  /** The trip for the car's own displays (the cluster behind the wheel, a head-up display) where it has them. */
  private fun trip(g: CarGuidance) {
    val step = g.step ?: return
    val trip = Trip.Builder().addStep(carStep(carContext, step), travelEstimate(step.estimate))
    g.target?.let { t -> (g.remaining ?: g.summary)?.let { trip.addDestination(Destination.Builder().setName(t.name).build(), travelEstimate(it)) } }
    step.street?.let { trip.setCurrentRoad(it) }
    runCatching { navigation().updateTrip(trip.build()) }
  }

  fun alert(message: String, button: String) {
    root?.let { it.screenManager.push(MessageScreen(carContext, message, button)) }
  }
}

/** "42.5063,1.5218" with an optional "(Name)", as geo: URIs carry a point. */
private val GEO_POINT = Regex("""^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*(?:\((.*)\))?\s*$""")
