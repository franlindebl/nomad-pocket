// A guidance step as Android Auto shows it: routing-core's ManeuverIcon (what CarPlay draws with SF Symbols) as the
// Car App Library's maneuver type and our own icon (Lucide, as the app). With no route, "straight-line" points at
// the target: the straight arrow turned by the step's rotation (degrees clockwise from the way the car goes).
package expo.modules.nomadcarplay

import android.graphics.Bitmap
import android.graphics.Canvas
import androidx.car.app.CarContext
import androidx.car.app.model.CarIcon
import androidx.car.app.navigation.model.Maneuver
import androidx.car.app.navigation.model.Step
import androidx.core.content.ContextCompat
import androidx.core.graphics.drawable.IconCompat

private val MANEUVERS =
  mapOf(
    "start" to (Maneuver.TYPE_DEPART to R.drawable.car_depart),
    "arrive" to (Maneuver.TYPE_DESTINATION to R.drawable.car_arrive),
    "straight" to (Maneuver.TYPE_STRAIGHT to R.drawable.car_straight),
    "slightRight" to (Maneuver.TYPE_TURN_SLIGHT_RIGHT to R.drawable.car_slight_right),
    "right" to (Maneuver.TYPE_TURN_NORMAL_RIGHT to R.drawable.car_turn_right),
    "sharpRight" to (Maneuver.TYPE_TURN_SHARP_RIGHT to R.drawable.car_sharp_right),
    "slightLeft" to (Maneuver.TYPE_TURN_SLIGHT_LEFT to R.drawable.car_slight_left),
    "left" to (Maneuver.TYPE_TURN_NORMAL_LEFT to R.drawable.car_turn_left),
    "sharpLeft" to (Maneuver.TYPE_TURN_SHARP_LEFT to R.drawable.car_sharp_left),
    "uturn" to (Maneuver.TYPE_U_TURN_LEFT to R.drawable.car_uturn),
    // The exit types need the exit's number, which the route's text already says ("take the 2nd exit").
    "roundabout" to (Maneuver.TYPE_ROUNDABOUT_ENTER_CCW to R.drawable.car_roundabout),
    "merge" to (Maneuver.TYPE_MERGE_SIDE_UNSPECIFIED to R.drawable.car_merge),
    "ferry" to (Maneuver.TYPE_FERRY_BOAT to R.drawable.car_ferry),
  )

/** The straight arrow turned by `degrees`, drawn at the size hosts show maneuvers (they scale it). */
private fun turnedArrow(car: CarContext, degrees: Float): CarIcon {
  val size = 144
  val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
  val canvas = Canvas(bitmap)
  canvas.rotate(degrees, size / 2f, size / 2f)
  ContextCompat.getDrawable(car, R.drawable.car_straight)?.apply {
    setBounds(0, 0, size, size)
    draw(canvas)
  }
  return CarIcon.Builder(IconCompat.createWithBitmap(bitmap)).build()
}

internal fun carStep(car: CarContext, s: CarStep): Step {
  val maneuver =
    if (s.icon == "straight-line") {
      Maneuver.Builder(Maneuver.TYPE_UNKNOWN).setIcon(turnedArrow(car, (s.rotation ?: 0.0).toFloat())).build()
    } else {
      val (type, res) = MANEUVERS[s.icon] ?: (Maneuver.TYPE_UNKNOWN to R.drawable.car_straight)
      Maneuver.Builder(type).setIcon(icon(car, res)).build()
    }
  return Step.Builder(s.instruction).setManeuver(maneuver).also { b -> s.street?.let { b.setRoad(it) } }.build()
}
