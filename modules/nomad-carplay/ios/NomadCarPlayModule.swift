// JS side of CarPlay (src/features/carplay): JS owns guidance (routes, progress, rerouting,
// voice), the data (saved places, emergency points, search) and the texts; it sends the car what
// to show, and the car sends back what the driver chose. The module instance comes and goes with
// React Native, the CarPlay scene with the car: both meet in CarPlayHub.
import ExpoModulesCore

public final class NomadCarPlayModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NomadCarPlay")
    Events("onConnect", "onDisconnect", "onRequest", "onPick", "onStart", "onEnd")

    OnCreate {
      CarPlayHub.shared.module = self
    }

    OnDestroy {
      if CarPlayHub.shared.module === self { CarPlayHub.shared.module = nil }
    }

    Function("isConnected") { () -> Bool in
      CarPlayHub.shared.connected
    }

    /// The texts the car shows (JSON: CarStrings), in the app language.
    AsyncFunction("setStrings") { (json: String) in
      CarPlayHub.shared.setStrings(json)
    }.runOnQueue(.main)

    /// The map styles (style JSON for the light and dark car appearance).
    AsyncFunction("setStyles") { (light: String, dark: String) in
      CarPlayHub.shared.setStyles(light: light, dark: dark)
    }.runOnQueue(.main)

    /// The route's line ([[lon, lat]]), empty for none.
    AsyncFunction("setRoute") { (shape: [[Double]]) in
      CarPlayHub.shared.setRoute(shape)
    }.runOnQueue(.main)

    /// Guidance as JS sees it (JSON: CarGuidance).
    AsyncFunction("update") { (json: String) in
      CarPlayHub.shared.update(json)
    }.runOnQueue(.main)

    /// A message on the car's screen with one button to close it.
    AsyncFunction("alert") { (message: String, button: String) in
      CarPlayHub.shared.controller?.alert(message, button: button)
    }.runOnQueue(.main)

    /// The items for an onRequest (JSON: [CarItem]).
    AsyncFunction("answer") { (id: Int, json: String) in
      CarPlayHub.shared.answer(id, json)
    }.runOnQueue(.main)
  }
}
