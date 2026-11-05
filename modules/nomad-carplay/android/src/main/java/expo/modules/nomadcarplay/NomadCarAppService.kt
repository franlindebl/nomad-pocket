// Android Auto's entry point (navigation category, AndroidManifest.xml): the host binds this service
// when the car shows the app, and each car connection is a Session (CarPlaySceneDelegate.swift's twin).
// The session owns the car's map (CarMap on the host's surface) and the screens; what JS last sent
// reaches it through CarHub.
package expo.modules.nomadcarplay

import android.content.Intent
import android.content.res.Configuration
import android.content.pm.ApplicationInfo
import androidx.car.app.AppManager
import androidx.car.app.CarAppService
import androidx.car.app.Screen
import androidx.car.app.Session
import androidx.car.app.navigation.NavigationManager
import androidx.car.app.navigation.NavigationManagerCallback
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
    return screen
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
    root?.show(guidance)
  }

  fun alert(message: String, button: String) {
    root?.let { it.screenManager.push(MessageScreen(carContext, message, button)) }
  }
}
