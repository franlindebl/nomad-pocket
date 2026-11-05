// JS side of the car screen on Android (Android Auto), with the same name and calls as the iOS
// module (NomadCarPlayModule.swift), so src/features/carplay drives both: JS owns guidance, the data
// and the texts; it sends the car what to show and the car sends back what the driver chose. The
// module comes and goes with React Native, the session with the car: both meet in CarHub.
package expo.modules.nomadcarplay

import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class NomadCarPlayModule : Module() {
  private val main = android.os.Handler(android.os.Looper.getMainLooper())

  internal fun emit(name: String, body: Map<String, Any?>) {
    sendEvent(name, body)
  }

  override fun definition() = ModuleDefinition {
    Name("NomadCarPlay")
    Events("onConnect", "onDisconnect", "onRequest", "onPick", "onStart", "onEnd")

    OnCreate { CarHub.module = this@NomadCarPlayModule }

    OnDestroy {
      if (CarHub.module === this@NomadCarPlayModule) {
        CarHub.module = null
        CarHub.observing = false
      }
    }

    // src/features/carplay subscribes once at startup: what the car queued meanwhile goes now.
    // CarHub is main-thread only; these come on JS's thread.
    OnStartObserving { main.post { CarHub.observing = true } }

    OnStopObserving { main.post { CarHub.observing = false } }

    Function("isConnected") { CarHub.connected }

    AsyncFunction("setStrings") { json: String -> CarHub.setStrings(json) }.runOnQueue(Queues.MAIN)

    AsyncFunction("setStyles") { light: String, dark: String -> CarHub.setStyles(light, dark) }.runOnQueue(Queues.MAIN)

    AsyncFunction("setRoute") { shape: List<List<Double>> ->
      CarHub.setRoute(shape.filter { it.size >= 2 }.map { doubleArrayOf(it[0], it[1]) })
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("update") { json: String -> CarHub.update(json) }.runOnQueue(Queues.MAIN)

    AsyncFunction("alert") { message: String, button: String -> CarHub.session?.alert(message, button) }.runOnQueue(Queues.MAIN)

    AsyncFunction("answer") { id: Int, json: String -> CarHub.answer(id, json) }.runOnQueue(Queues.MAIN)
  }
}
