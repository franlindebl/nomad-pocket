// Where the JS module and the Android Auto session meet (CarPlayHub.swift's twin). Either can come
// first: the phone app runs without a car, and the car can start the app's process with no activity
// (then React Native isn't running yet). The hub keeps what JS last sent and hands it to the session
// when it starts; events to JS go through the module once it exists. Main thread only.
package expo.modules.nomadcarplay

import android.os.Handler
import android.os.Looper
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject

// What JS sends (JSON from src/features/carplay/carplay-core.ts).

data class CarDistance(val value: Double, val unit: String)

data class CarEstimate(val distance: CarDistance, val seconds: Double)

data class CarStep(
  val index: Int,
  val icon: String,
  val instruction: String,
  val street: String?,
  val estimate: CarEstimate,
  val rotation: Double?,
)

data class CarTarget(val name: String, val lat: Double, val lon: Double)

data class CarGuidance(
  val target: CarTarget?,
  val navigating: Boolean,
  val routing: String,
  val routeId: Int,
  val arrived: Boolean,
  val summary: CarEstimate?,
  val remaining: CarEstimate?,
  val step: CarStep?,
  val nextStep: CarStep?,
  val note: String?,
)

data class CarItem(val title: String, val detail: String?, val lat: Double, val lon: Double)

data class CarStrings(
  val destinations: String,
  val search: String,
  val saved: String,
  val savedEmpty: String,
  val emergency: String,
  val emergencyEmpty: String,
  val searchEmpty: String,
  val categories: List<Pair<String, String>>,
  val go: String,
  val cancel: String,
  val done: String,
  val end: String,
  val rerouting: String,
  val arrived: String,
  val noLocation: String,
  val straightLine: String,
)

private fun JSONObject.str(key: String): String? = if (isNull(key)) null else optString(key)

private fun JSONObject.obj(key: String): JSONObject? = if (isNull(key)) null else optJSONObject(key)

private fun estimate(o: JSONObject?): CarEstimate? =
  o?.let {
    val d = it.getJSONObject("distance")
    CarEstimate(CarDistance(d.getDouble("value"), d.getString("unit")), it.getDouble("seconds"))
  }

private fun step(o: JSONObject?): CarStep? =
  o?.let {
    CarStep(
      it.getInt("index"),
      it.getString("icon"),
      it.getString("instruction"),
      it.str("street"),
      estimate(it.getJSONObject("estimate"))!!,
      if (it.has("rotation") && !it.isNull("rotation")) it.getDouble("rotation") else null,
    )
  }

internal fun parseGuidance(json: String): CarGuidance {
  val o = JSONObject(json)
  return CarGuidance(
    target = o.obj("target")?.let { CarTarget(it.getString("name"), it.getDouble("lat"), it.getDouble("lon")) },
    navigating = o.getBoolean("navigating"),
    routing = o.getString("routing"),
    routeId = o.getInt("routeId"),
    arrived = o.getBoolean("arrived"),
    summary = estimate(o.obj("summary")),
    remaining = estimate(o.obj("remaining")),
    step = step(o.obj("step")),
    nextStep = step(o.obj("nextStep")),
    note = o.str("note"),
  )
}

internal fun parseStrings(json: String): CarStrings {
  val o = JSONObject(json)
  val cats = o.getJSONArray("categories")
  return CarStrings(
    destinations = o.getString("destinations"),
    search = o.getString("search"),
    saved = o.getString("saved"),
    savedEmpty = o.getString("savedEmpty"),
    emergency = o.getString("emergency"),
    emergencyEmpty = o.getString("emergencyEmpty"),
    searchEmpty = o.getString("searchEmpty"),
    categories = (0 until cats.length()).map { cats.getJSONArray(it).let { c -> c.getString(0) to c.getString(1) } },
    go = o.getString("go"),
    cancel = o.getString("cancel"),
    done = o.getString("done"),
    end = o.getString("end"),
    rerouting = o.getString("rerouting"),
    arrived = o.getString("arrived"),
    noLocation = o.getString("noLocation"),
    straightLine = o.getString("straightLine"),
  )
}

internal fun parseItems(json: String): List<CarItem> {
  val a = JSONArray(json)
  return (0 until a.length()).map {
    val o = a.getJSONObject(it)
    CarItem(o.getString("title"), o.str("detail"), o.getDouble("lat"), o.getDouble("lon"))
  }
}

object CarHub {
  private const val TAG = "NomadCar"

  var module: NomadCarPlayModule? = null
  var session: NomadCarSession? = null
    set(value) {
      field = value
      value?.let { replay(it) }
    }
  val connected: Boolean
    get() = session != null

  var strings: CarStrings? = null
    private set
  var styles: Pair<String, String>? = null
    private set
  var route: List<DoubleArray> = emptyList()
    private set
  var guidance: CarGuidance? = null
    private set

  private val main = Handler(Looper.getMainLooper())
  private var nextRequest = 0
  private val pending = mutableMapOf<Int, (List<CarItem>) -> Unit>()

  fun emit(name: String, body: Map<String, Any?> = emptyMap()) {
    module?.emit(name, body)
  }

  fun setStrings(json: String) {
    val s = decode { parseStrings(json) } ?: return
    strings = s
    session?.apply(s)
  }

  fun setStyles(light: String, dark: String) {
    styles = light to dark
    session?.map?.setStyles(light, dark)
  }

  fun setRoute(shape: List<DoubleArray>) {
    route = shape
    session?.map?.setRoute(shape)
  }

  fun update(json: String) {
    val g = decode { parseGuidance(json) } ?: return
    guidance = g
    session?.apply(g)
  }

  /** Asks JS for list items; `done` gets them, or nothing after a while (JS not running yet). */
  fun request(kind: String, extra: Map<String, Any?> = emptyMap(), done: (List<CarItem>) -> Unit) {
    val id = ++nextRequest
    pending[id] = done
    val body = extra.toMutableMap()
    body["id"] = id
    body["kind"] = kind
    // The car's own fix: JS may have none (no trip, the phone locked) and the lists sort by distance.
    session?.map?.position?.let {
      body["lat"] = it.latitude
      body["lon"] = it.longitude
    }
    emit("onRequest", body)
    main.postDelayed({ pending.remove(id)?.invoke(emptyList()) }, 8000)
  }

  fun answer(id: Int, json: String) {
    val items = decode { parseItems(json) } ?: emptyList()
    pending.remove(id)?.invoke(items)
  }

  private fun replay(s: NomadCarSession) {
    strings?.let { s.apply(it) }
    styles?.let { s.map?.setStyles(it.first, it.second) }
    s.map?.setRoute(route)
    guidance?.let { s.apply(it) }
  }

  private fun <T> decode(parse: () -> T): T? =
    try {
      parse()
    } catch (e: Exception) {
      Log.w(TAG, "bad JSON from JS", e)
      null
    }
}
