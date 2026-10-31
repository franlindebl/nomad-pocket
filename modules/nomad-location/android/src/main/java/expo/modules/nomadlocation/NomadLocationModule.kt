// Location and compass on Android without Google Play services: the system's LocationManager (its
// fused provider on Android 12+, GPS and the network provider before) and the magnetometer with the
// accelerometer, behind the few calls the app makes (src/lib/location.android.ts). expo-location
// needs play-services-location, a proprietary library that can't ship next to GPL libkiwix, so it is
// left out of Android autolinking (package.json). Results have expo-location's shapes and its
// behaviour where the app relies on it: watches and the compass pause while the app is in the
// background, true north comes from GeomagneticField at the last known position. A navigation
// watch is the exception: it keeps going in the background, inside a foreground service
// (NavigationService) started while the app is in front, so no background permission is needed.
//
// Everything runs on the main thread (listeners, sensors and the functions), so the state below
// needs no locking.
package expo.modules.nomadlocation

import android.Manifest
import android.content.Context
import android.hardware.GeomagneticField
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.location.LocationRequest
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import expo.modules.interfaces.permissions.Permissions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlin.math.abs

// expo-location's Accuracy values (Lowest 1 … BestForNavigation 6).
private const val ACCURACY_LOWEST = 1
private const val ACCURACY_HIGH = 4
private const val ACCURACY_NAVIGATION = 6
private const val FIX_TIMEOUT_MS = 30_000L
// With two providers (below Android 12), a network fix is dropped while GPS gave one this recently.
private const val GPS_PREFERRED_MS = 10_000L
// expo-location's compass thresholds: ~2° of change, at most every 50 ms.
private const val AZIMUTH_DELTA = 0.0355f
private const val HEADING_MIN_MS = 50L

private const val COARSE = Manifest.permission.ACCESS_COARSE_LOCATION
private const val FINE = Manifest.permission.ACCESS_FINE_LOCATION

class NomadLocationModule : Module(), SensorEventListener {
  private val context: Context
    get() = appContext.reactContext ?: throw CodedException("ERR_NO_CONTEXT", "The React context is gone", null)
  private val manager: LocationManager
    get() = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
  private val sensors: SensorManager?
    get() = appContext.reactContext?.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
  private val main = Handler(Looper.getMainLooper())

  private class Watch(val accuracy: Int, val distance: Float, val intervalMs: Long, val navigation: Boolean = false) {
    val listeners = mutableListOf<LocationListener>()
    var lastGpsAt = 0L
  }

  private val watches = mutableMapOf<Int, Watch>()
  private var foreground = true
  private var headingOn = false
  private var gravity: FloatArray? = null
  private var geomagnetic: FloatArray? = null
  private var compassAccuracy = 0
  private var lastAzimuth = 0f
  private var lastHeadingAt = 0L
  private var declination: Float? = null

  override fun definition() = ModuleDefinition {
    Name("NomadLocation")
    Events("onLocation", "onHeading", "onNavigation")

    // Granted means at least approximate location, as expo-location reports it.
    AsyncFunction("getPermissions") { promise: Promise ->
      Permissions.getPermissionsWithPermissionsManager(appContext.permissions, promise, COARSE)
    }

    // Both are asked: Android 12+ lets the person choose approximate.
    AsyncFunction("requestPermissions") { promise: Promise ->
      val perms = appContext.permissions
        ?: return@AsyncFunction promise.reject("E_NO_PERMISSIONS", "The permissions module is missing", null)
      perms.askForPermissions({ _ -> Permissions.getPermissionsWithPermissionsManager(perms, promise, COARSE) }, FINE, COARSE)
    }

    // Negative maxAgeMs / requiredAccuracy: no limit.
    AsyncFunction("getLastKnown") { maxAgeMs: Double, requiredAccuracy: Double ->
      lastKnown()
        ?.takeIf { (maxAgeMs < 0 || ageMs(it) <= maxAgeMs) && (requiredAccuracy < 0 || it.accuracy <= requiredAccuracy) }
        ?.let(::toBundle)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("getCurrent") { accuracy: Int, promise: Promise ->
      if (!locationEnabled()) {
        return@AsyncFunction promise.reject("E_LOCATION_SERVICES_DISABLED", "Location services are disabled", null)
      }
      // Every provider for one fix: the first one wins, and GPS only runs until then.
      val providers = providers(ACCURACY_HIGH)
      val listeners = mutableListOf<LocationListener>()
      var done = false
      lateinit var timeout: Runnable
      fun finish(fix: Location?) {
        if (done) return
        done = true
        main.removeCallbacks(timeout)
        listeners.forEach { manager.removeUpdates(it) }
        if (fix != null) {
          noteDeclination(fix)
          promise.resolve(toBundle(fix))
        } else {
          promise.reject("E_LOCATION_UNAVAILABLE", "No location fix in ${FIX_TIMEOUT_MS / 1000} s", null)
        }
      }
      timeout = Runnable { finish(null) }
      for (provider in providers) {
        val listener = Listener { finish(it) }
        if (request(provider, accuracy, 0L, 0f, listener)) listeners += listener
      }
      if (listeners.isEmpty()) return@AsyncFunction promise.reject("E_NO_PERMISSIONS", "Location permission not granted", null)
      main.postDelayed(timeout, FIX_TIMEOUT_MS)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("startWatch") { id: Int, accuracy: Int, distance: Double, intervalMs: Double ->
      val watch = Watch(accuracy, distance.toFloat(), intervalMs.toLong())
      watches.remove(id)?.let(::pause)
      watches[id] = watch
      if (foreground) resume(id, watch)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("stopWatch") { id: Int ->
      watches.remove(id)?.let(::pause)
      Unit
    }.runOnQueue(Queues.MAIN)

    // Fixes arrive as onNavigation events, also with the app in the background; the notice is the
    // service's notification ("Navigating to …"). `automotive` is for iOS (its activity type).
    AsyncFunction("startNavigation") { id: Int, distance: Double, intervalMs: Double, title: String, body: String, _: Boolean ->
      val watch = Watch(ACCURACY_NAVIGATION, distance.toFloat(), intervalMs.toLong(), navigation = true)
      watches.remove(id)?.let(::pause)
      watches[id] = watch
      NavigationService.start(context, title, body)
      resume(id, watch)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("stopNavigation") { id: Int ->
      watches.remove(id)?.let(::pause)
      if (watches.values.none { it.navigation }) NavigationService.stop(context)
      Unit
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("startHeading") { ->
      val sm = sensors
      if (sm?.getDefaultSensor(Sensor.TYPE_MAGNETIC_FIELD) == null) throw CodedException("E_NO_COMPASS", "This device has no compass", null)
      headingOn = true
      lastKnown()?.let(::noteDeclination) ?: oneLowFixForDeclination()
      if (foreground) registerSensors(sm)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("stopHeading") { ->
      headingOn = false
      sensors?.unregisterListener(this@NomadLocationModule)
      Unit
    }.runOnQueue(Queues.MAIN)

    OnActivityEntersBackground {
      main.post {
        foreground = false
        watches.values.filterNot { it.navigation }.forEach(::pause)
        sensors?.unregisterListener(this@NomadLocationModule)
      }
    }

    OnActivityEntersForeground {
      main.post {
        if (foreground) return@post
        foreground = true
        watches.forEach { (id, watch) -> resume(id, watch) }
        if (headingOn) sensors?.let(::registerSensors)
      }
    }

    OnDestroy {
      main.post {
        watches.values.forEach(::pause)
        if (watches.values.any { it.navigation }) appContext.reactContext?.let(NavigationService::stop)
        watches.clear()
        sensors?.unregisterListener(this@NomadLocationModule)
      }
    }
  }

  // Location ------------------------------------------------------------------------------------

  /**
   * The providers for a watch of this accuracy. Ones that are switched off are still listed:
   * their updates start when the person turns location on.
   */
  private fun providers(accuracy: Int): List<String> {
    val all = manager.allProviders
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && LocationManager.FUSED_PROVIDER in all) {
      return listOf(LocationManager.FUSED_PROVIDER)
    }
    val usable = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER).filter { it in all }
    if (accuracy >= ACCURACY_HIGH) return usable
    // Low power: the network provider when the phone has one.
    return usable.reversed().take(1)
  }

  private fun locationEnabled(): Boolean =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) manager.isLocationEnabled else manager.getProviders(true).isNotEmpty()

  /** Starts updates; false when the permission is missing or the provider can't be used. */
  private fun request(provider: String, accuracy: Int, intervalMs: Long, distance: Float, listener: LocationListener): Boolean =
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        val quality = when {
          accuracy >= ACCURACY_HIGH -> LocationRequest.QUALITY_HIGH_ACCURACY
          accuracy <= ACCURACY_LOWEST -> LocationRequest.QUALITY_LOW_POWER
          else -> LocationRequest.QUALITY_BALANCED_POWER_ACCURACY
        }
        val req = LocationRequest.Builder(intervalMs).setQuality(quality).setMinUpdateDistanceMeters(distance).build()
        manager.requestLocationUpdates(provider, req, context.mainExecutor, listener)
      } else {
        manager.requestLocationUpdates(provider, intervalMs, distance, listener, Looper.getMainLooper())
      }
      true
    } catch (e: SecurityException) {
      false
    } catch (e: IllegalArgumentException) {
      false
    }

  private fun resume(id: Int, watch: Watch) {
    if (watch.listeners.isNotEmpty()) return
    for (provider in providers(watch.accuracy)) {
      val listener = Listener { fix ->
        val now = SystemClock.elapsedRealtime()
        if (fix.provider == LocationManager.GPS_PROVIDER) watch.lastGpsAt = now
        else if (watch.lastGpsAt > 0 && now - watch.lastGpsAt < GPS_PREFERRED_MS) return@Listener
        noteDeclination(fix)
        sendEvent(if (watch.navigation) "onNavigation" else "onLocation", Bundle().apply {
          putInt("watchId", id)
          putBundle("location", toBundle(fix))
        })
      }
      if (request(provider, watch.accuracy, watch.intervalMs, watch.distance, listener)) watch.listeners += listener
    }
  }

  private fun pause(watch: Watch) {
    watch.listeners.forEach { manager.removeUpdates(it) }
    watch.listeners.clear()
  }

  /** The most recent fix any provider kept, or null (also without the permission). */
  private fun lastKnown(): Location? =
    manager.allProviders
      .mapNotNull { runCatching { manager.getLastKnownLocation(it) }.getOrNull() }
      .maxByOrNull { it.elapsedRealtimeNanos }

  private fun ageMs(fix: Location) = (SystemClock.elapsedRealtimeNanos() - fix.elapsedRealtimeNanos) / 1_000_000.0

  private fun toBundle(fix: Location) = Bundle().apply {
    putBundle("coords", Bundle().apply {
      putDouble("latitude", fix.latitude)
      putDouble("longitude", fix.longitude)
      putDouble("altitude", fix.altitude)
      putDouble("accuracy", fix.accuracy.toDouble())
      putDouble("altitudeAccuracy", fix.verticalAccuracyMeters.toDouble())
      putDouble("heading", fix.bearing.toDouble())
      putDouble("speed", fix.speed.toDouble())
    })
    putDouble("timestamp", fix.time.toDouble())
    @Suppress("DEPRECATION")
    putBoolean("mocked", if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) fix.isMock else fix.isFromMockProvider)
  }

  // Compass -------------------------------------------------------------------------------------

  private fun registerSensors(sm: SensorManager) {
    sm.getDefaultSensor(Sensor.TYPE_MAGNETIC_FIELD)?.let { sm.registerListener(this, it, SensorManager.SENSOR_DELAY_NORMAL) }
    sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)?.let { sm.registerListener(this, it, SensorManager.SENSOR_DELAY_NORMAL) }
  }

  private fun noteDeclination(fix: Location) {
    declination = GeomagneticField(fix.latitude.toFloat(), fix.longitude.toFloat(), fix.altitude.toFloat(), System.currentTimeMillis()).declination
  }

  /** No fix kept anywhere: one low-power fix, only to know true north. */
  private fun oneLowFixForDeclination() {
    for (provider in providers(ACCURACY_LOWEST)) {
      lateinit var listener: LocationListener
      listener = Listener { fix ->
        manager.removeUpdates(listener)
        noteDeclination(fix)
      }
      request(provider, ACCURACY_LOWEST, 0L, 0f, listener)
    }
  }

  override fun onSensorChanged(event: SensorEvent) {
    when (event.sensor.type) {
      Sensor.TYPE_ACCELEROMETER -> gravity = event.values.clone()
      Sensor.TYPE_MAGNETIC_FIELD -> geomagnetic = event.values.clone()
    }
    val g = gravity ?: return
    val m = geomagnetic ?: return
    val rotation = FloatArray(9)
    if (!SensorManager.getRotationMatrix(rotation, null, g, m)) return
    val orientation = FloatArray(3)
    SensorManager.getOrientation(rotation, orientation)
    val now = SystemClock.elapsedRealtime()
    if (abs(orientation[0] - lastAzimuth) <= AZIMUTH_DELTA || now - lastHeadingAt <= HEADING_MIN_MS) return
    lastAzimuth = orientation[0]
    lastHeadingAt = now
    val magnetic = (Math.toDegrees(orientation[0].toDouble()) + 360) % 360
    val trueNorth = declination?.let { (magnetic + it + 360) % 360 } ?: -1.0
    sendEvent("onHeading", Bundle().apply {
      putDouble("magHeading", magnetic)
      putDouble("trueHeading", trueNorth)
      putInt("accuracy", compassAccuracy)
    })
  }

  override fun onAccuracyChanged(sensor: Sensor, accuracy: Int) {
    if (sensor.type == Sensor.TYPE_MAGNETIC_FIELD) compassAccuracy = accuracy
  }
}

/**
 * Before Android 11 the provider callbacks have no default bodies: a listener without them throws
 * AbstractMethodError when a provider is switched off.
 */
private class Listener(val onFix: (Location) -> Unit) : LocationListener {
  override fun onLocationChanged(location: Location) = onFix(location)

  override fun onProviderEnabled(provider: String) {}

  override fun onProviderDisabled(provider: String) {}

  @Deprecated("Deprecated in Android")
  @Suppress("OVERRIDE_DEPRECATION")
  override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
}
