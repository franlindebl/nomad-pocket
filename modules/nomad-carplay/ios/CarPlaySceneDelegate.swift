// The CarPlay scene (Info.plist: CPTemplateApplicationSceneSessionRoleApplication, set by
// plugins/with-carplay.js). A navigation app draws its own map in the car's window; the
// templates go through the interface controller.
import CarPlay
import UIKit

@objc(NomadCarPlaySceneDelegate)
public final class NomadCarPlaySceneDelegate: UIResponder, CPTemplateApplicationSceneDelegate {
  private var controller: CarPlayController?

  public func templateApplicationScene(
    _ templateApplicationScene: CPTemplateApplicationScene,
    didConnect interfaceController: CPInterfaceController,
    to window: CPWindow
  ) {
    // Opened from the car with the phone app not running: start React Native behind it.
    CarPlayBoot.ensureReactNative()
    let controller = CarPlayController(interface: interfaceController, window: window)
    self.controller = controller
    CarPlayHub.shared.controller = controller
    CarPlayHub.shared.emit("onConnect")
  }

  public func templateApplicationScene(
    _ templateApplicationScene: CPTemplateApplicationScene,
    didDisconnect interfaceController: CPInterfaceController,
    from window: CPWindow
  ) {
    controller?.disconnect()
    controller = nil
    CarPlayHub.shared.controller = nil
    CarPlayHub.shared.emit("onDisconnect")
  }
}
