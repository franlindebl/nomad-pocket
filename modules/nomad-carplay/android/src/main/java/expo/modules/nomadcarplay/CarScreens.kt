// The car's screens, from Android Auto's templates (CarPlayController.swift's twin): the map with the
// trip (NavigationTemplate), Destinos (saved places, Emergencias cerca, search) and their lists, which
// JS fills through CarHub.request. A destination goes to JS (onPick), which routes it; "Ir" and
// "Terminar" go back the same way (onStart, onEnd), and guidance comes back through CarHub.update.
@file:Suppress("DEPRECATION") // setTitle / setHeaderAction: Header needs a newer car API than many cars have.

package expo.modules.nomadcarplay

import android.text.SpannableString
import android.text.Spanned
import androidx.activity.OnBackPressedCallback
import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.constraints.ConstraintManager
import androidx.car.app.model.Action
import androidx.car.app.model.ActionStrip
import androidx.car.app.model.CarIcon
import androidx.car.app.model.DateTimeWithZone
import androidx.car.app.model.Distance
import androidx.car.app.model.DistanceSpan
import androidx.car.app.model.DurationSpan
import androidx.car.app.model.ItemList
import androidx.car.app.model.ListTemplate
import androidx.car.app.model.MessageTemplate
import androidx.car.app.model.Row
import androidx.car.app.model.SearchTemplate
import androidx.car.app.model.Template
import androidx.car.app.navigation.model.MessageInfo
import androidx.car.app.navigation.model.NavigationTemplate
import androidx.car.app.navigation.model.RoutePreviewNavigationTemplate
import androidx.car.app.navigation.model.RoutingInfo
import androidx.car.app.navigation.model.TravelEstimate
import androidx.core.graphics.drawable.IconCompat
import java.util.TimeZone

internal fun icon(car: CarContext, res: Int) = CarIcon.Builder(IconCompat.createWithResource(car, res)).build()

internal fun distance(d: CarDistance): Distance {
  val unit =
    when (d.unit) {
      "km" -> if (d.value < 10) Distance.UNIT_KILOMETERS_P1 else Distance.UNIT_KILOMETERS
      "mi" -> if (d.value < 10) Distance.UNIT_MILES_P1 else Distance.UNIT_MILES
      "ft" -> Distance.UNIT_FEET
      "yd" -> Distance.UNIT_YARDS
      else -> Distance.UNIT_METERS
    }
  return Distance.create(d.value, unit)
}

internal fun travelEstimate(e: CarEstimate): TravelEstimate =
  TravelEstimate.Builder(distance(e.distance), DateTimeWithZone.create(System.currentTimeMillis() + (e.seconds * 1000).toLong(), TimeZone.getDefault()))
    .setRemainingTimeSeconds(e.seconds.toLong())
    .build()

/** Rows a list may show (the car's limit while driving, often 6). */
internal fun listLimit(car: CarContext): Int =
  if (car.carAppApiLevel >= 2) car.getCarService(ConstraintManager::class.java).getContentLimit(ConstraintManager.CONTENT_LIMIT_TYPE_LIST) else 6

class MapScreen(car: CarContext, internal val map: CarMap) : Screen(car) {
  internal var guidance: CarGuidance? = null
    private set
  private var shownRoute = -1
  private var shownKey: String? = null

  /**
   * The trip preview is its own screen on top of this one: the host refuses a screen whose template changes type
   * when the driver comes back to it ("BackFlowViolationException: Template types differ"), and the preview goes
   * back to the map every time.
   */
  private var preview: PreviewScreen? = null
  /** The target whose preview the driver closed: not shown again while JS ends that trip. */
  private var dismissed: CarTarget? = null

  private fun previewing(g: CarGuidance?) = g?.target != null && !g.navigating && !g.arrived && g.target != dismissed

  fun show(g: CarGuidance) {
    // A new route before the trip starts: the whole of it beside the preview card.
    if (g.target != null && !g.navigating && g.routing == "ready" && g.routeId != shownRoute) {
      shownRoute = g.routeId
      map.showOverview(g.target)
    }
    if (g.target == null) shownRoute = -1
    if (g.target != dismissed) dismissed = null
    guidance = g
    val open = preview
    if (previewing(g)) {
      if (open == null) PreviewScreen(carContext, this).also { preview = it; screenManager.push(it) } else open.update()
    } else if (open != null) {
      preview = null
      if (screenManager.top === open) screenManager.pop() else screenManager.remove(open)
    }
    // Only when what the template shows changed: every new template replaces the host's buttons,
    // and a tap that lands while they are replaced is lost (JS sends guidance on every fix).
    val key = shown(g)
    if (key != shownKey) {
      shownKey = key
      invalidate()
    }
  }

  private fun shown(g: CarGuidance): String {
    val est = { e: CarEstimate? -> e?.let { "${it.distance.value}${it.distance.unit}/${(it.seconds / 60).toInt()}" } }
    val step = { s: CarStep? -> s?.let { "${it.index}:${it.icon}:${it.instruction}:${est(it.estimate)}" } }
    return listOf(g.target, g.navigating, g.routing, g.arrived, g.note, step(g.step), step(g.nextStep), est(g.remaining ?: g.summary)).joinToString("|")
  }

  /** Back or Cancel on the preview: the trip ends (JS) and the map shows again at once. */
  internal fun previewClosed(screen: PreviewScreen) {
    if (preview !== screen) return
    preview = null
    dismissed = guidance?.target
    CarHub.emit("onEnd")
  }

  internal fun mapActions(): ActionStrip {
    val b =
      ActionStrip.Builder()
        .addAction(Action.PAN)
        .addAction(Action.Builder().setIcon(icon(carContext, R.drawable.car_zoom_in)).setOnClickListener { map.zoom(1.0) }.build())
        .addAction(Action.Builder().setIcon(icon(carContext, R.drawable.car_zoom_out)).setOnClickListener { map.zoom(-1.0) }.build())
    if (!map.following) b.addAction(Action.Builder().setIcon(icon(carContext, R.drawable.car_recenter)).setOnClickListener { map.recentre() }.build())
    return b.build()
  }

  override fun onGetTemplate(): Template = navigation(CarHub.strings, guidance)

  private fun navigation(s: CarStrings?, g: CarGuidance?): Template {
    val actions = ActionStrip.Builder()
    if (g?.target != null && s != null) {
      actions.addAction(Action.Builder().setTitle(s.end).setOnClickListener { CarHub.emit("onEnd") }.build())
    } else {
      actions.addAction(
        Action.Builder()
          .setIcon(icon(carContext, R.drawable.car_destinations))
          .also { b -> s?.let { b.setTitle(it.destinations) } }
          .setOnClickListener { screenManager.push(DestinationsScreen(carContext)) }
          .build(),
      )
    }
    val template = NavigationTemplate.Builder().setActionStrip(actions.build()).setMapActionStrip(mapActions())
    if (g?.target != null) {
      val step = g.step
      when {
        g.arrived && s != null -> template.setNavigationInfo(MessageInfo.Builder(s.arrived).setText(g.target.name).build())
        g.routing == "loading" -> template.setNavigationInfo(RoutingInfo.Builder().setLoading(true).build())
        step != null -> {
          val info = RoutingInfo.Builder().setCurrentStep(carStep(carContext, step), distance(step.estimate.distance))
          g.nextStep?.let { info.setNextStep(carStep(carContext, it)) }
          template.setNavigationInfo(info.build())
        }
      }
      if (!g.arrived) (g.remaining ?: g.summary)?.let { template.setDestinationTravelEstimate(travelEstimate(it)) }
    }
    return template.build()
  }
}

/** Before "Ir": the destination, the trip's time and length and what it goes by, the route framed beside it. */
class PreviewScreen(car: CarContext, private val owner: MapScreen) : Screen(car) {
  private var shownKey: String? = null

  init {
    car.onBackPressedDispatcher.addCallback(
      this,
      object : OnBackPressedCallback(true) {
        override fun handleOnBackPressed() {
          owner.previewClosed(this@PreviewScreen)
          screenManager.pop()
        }
      },
    )
  }

  private fun key(g: CarGuidance?) = listOf(g?.target, g?.routing, g?.note, g?.summary?.distance, g?.summary?.seconds?.let { (it / 60).toInt() }).joinToString("|")

  fun update() {
    val k = key(owner.guidance)
    if (k != shownKey) {
      shownKey = k
      invalidate()
    }
  }

  override fun onGetTemplate(): Template {
    val s = CarHub.strings
    val g = owner.guidance
    shownKey = key(g)
    val b =
      RoutePreviewNavigationTemplate.Builder()
        .setTitle(g?.target?.name ?: "")
        .setHeaderAction(Action.BACK)
        .setMapActionStrip(owner.mapActions())
    s?.let { b.setNavigateAction(Action.Builder().setTitle(it.go).setOnClickListener { CarHub.emit("onStart") }.build()) }
    val summary = g?.summary
    if (s == null || g == null || g.routing == "loading" || summary == null) return b.setLoading(true).build()
    // "12 min · 7,1 km", formatted by the host in the car's language and units.
    val title = SpannableString("  ·  ")
    title.setSpan(DurationSpan.create(summary.seconds.toLong()), 0, 1, Spanned.SPAN_INCLUSIVE_INCLUSIVE)
    title.setSpan(DistanceSpan.create(distance(summary.distance)), 4, 5, Spanned.SPAN_INCLUSIVE_INCLUSIVE)
    val row = Row.Builder().setTitle(title)
    // No route (no pack, nothing found): as the crow flies, said so.
    val note = if (g.routing == "ready") g.note else s.straightLine
    note?.let { row.addText(it) }
    // The template wants a selectable list, even with one route.
    return b.setItemList(ItemList.Builder().addItem(row.build()).setOnSelectedListener {}.setSelectedIndex(0).build()).build()
  }
}

class DestinationsScreen(car: CarContext) : Screen(car) {
  override fun onGetTemplate(): Template {
    val s = CarHub.strings
    val list = ItemList.Builder()
    if (s != null) {
      list.addItem(Row.Builder().setTitle(s.saved).setBrowsable(true).setOnClickListener { screenManager.push(ItemsScreen(carContext, s.saved, "saved")) }.build())
      list.addItem(Row.Builder().setTitle(s.emergency).setBrowsable(true).setOnClickListener { screenManager.push(CategoriesScreen(carContext)) }.build())
      list.addItem(Row.Builder().setTitle(s.search).setBrowsable(true).setOnClickListener { screenManager.push(SearchScreen(carContext)) }.build())
    }
    return ListTemplate.Builder().setTitle(s?.destinations ?: "").setHeaderAction(Action.BACK).setSingleList(list.build()).build()
  }
}

class CategoriesScreen(car: CarContext) : Screen(car) {
  override fun onGetTemplate(): Template {
    val s = CarHub.strings
    val list = ItemList.Builder()
    s?.categories?.take(listLimit(carContext))?.forEach { (id, label) ->
      list.addItem(Row.Builder().setTitle(label).setBrowsable(true).setOnClickListener { screenManager.push(ItemsScreen(carContext, label, "emergency", category = id)) }.build())
    }
    return ListTemplate.Builder().setTitle(s?.emergency ?: "").setHeaderAction(Action.BACK).setSingleList(list.build()).build()
  }
}

/** Rows that start a trip: the destination goes to JS, and the car goes back to the map. */
internal fun pickRows(screen: Screen, items: List<CarItem>, limit: Int): ItemList {
  val list = ItemList.Builder()
  items.take(limit).forEach { item ->
    val row = Row.Builder().setTitle(item.title)
    item.detail?.let { row.addText(it) }
    row.setOnClickListener {
      CarHub.emit("onPick", mapOf("name" to item.title, "lat" to item.lat, "lon" to item.lon))
      screen.screenManager.popToRoot()
    }
    list.addItem(row.build())
  }
  return list.build()
}

class ItemsScreen(car: CarContext, private val title: String, kind: String, category: String? = null) : Screen(car) {
  private var items: List<CarItem>? = null

  init {
    CarHub.request(kind, if (category != null) mapOf("category" to category) else emptyMap()) {
      items = it
      invalidate()
    }
  }

  override fun onGetTemplate(): Template {
    val b = ListTemplate.Builder().setTitle(title).setHeaderAction(Action.BACK)
    val list = items ?: return b.setLoading(true).build()
    val s = CarHub.strings
    val rows = pickRows(this, list, listLimit(carContext))
    val empty = if (title == s?.saved) s.savedEmpty else s?.emergencyEmpty
    return b.setSingleList(if (list.isEmpty()) ItemList.Builder().setNoItemsMessage(empty ?: "").build() else rows).build()
  }
}

class SearchScreen(car: CarContext, private val initial: String? = null) : Screen(car) {
  private var items: List<CarItem>? = null
  private var query = 0
  private val main = android.os.Handler(android.os.Looper.getMainLooper())

  init {
    // A destination given as text (an address from another app): searched right away.
    initial?.let { submit(it) }
  }

  private fun submit(searchText: String) {
    if (searchText.isBlank()) return
    // No loading state: the offline search answers in tens of milliseconds, and two templates that
    // close together make the host delay the second one ("too many refreshes"), sometimes for good.
    val mine = ++query
    CarHub.request("search", mapOf("query" to searchText)) {
      if (mine != query) return@request
      items = it
      invalidate()
      // A refresh the host delayed anyway shows once the burst is over.
      main.postDelayed({ if (mine == query) invalidate() }, 1500)
    }
  }

  override fun onGetTemplate(): Template {
    val s = CarHub.strings
    val b =
      SearchTemplate.Builder(
        object : SearchTemplate.SearchCallback {
          override fun onSearchSubmitted(searchText: String) = submit(searchText)
        },
      )
        .setHeaderAction(Action.BACK)
        .setShowKeyboardByDefault(items == null)
    initial?.let { b.setInitialSearchText(it) }
    s?.let { b.setSearchHint(it.search) }
    val list = items
    return when {
      list == null -> b.setItemList(ItemList.Builder().build()).build()
      list.isEmpty() -> b.setItemList(ItemList.Builder().setNoItemsMessage(s?.searchEmpty ?: "").build()).build()
      else -> b.setItemList(pickRows(this, list, listLimit(carContext))).build()
    }
  }
}

class MessageScreen(car: CarContext, private val message: String, private val button: String) : Screen(car) {
  override fun onGetTemplate(): Template =
    MessageTemplate.Builder(message).addAction(Action.Builder().setTitle(button).setOnClickListener { screenManager.pop() }.build()).build()
}
