// Starting the app from the car. Expo starts React Native when the phone's window scene connects
// (ExpoAppSceneDelegate). Opened from CarPlay with the phone locked or the app not running, only
// the CarPlay scene connects, so JS (guidance, routes, voice, the data behind the lists) never
// started. Here React Native starts behind the car's map: its root view sits invisible in the
// car's window, because a surface in a window no screen shows never laid out, so the app never
// rendered and its startup (features/bootstrap) never ran (seen in the simulator: no styles came).
// When the phone scene connects later, its SceneDelegate (rewritten by plugins/with-carplay.js)
// adopts that root view controller instead of starting a second copy of the app.
internal import Expo
import React
import UIKit

@objc(NomadCarPlayBoot)
public final class CarPlayBoot: NSObject {
  private static var hiddenWindow: UIWindow?

  static func ensureReactNative(behind carWindow: UIWindow) {
    let phone = UIApplication.shared.connectedScenes.contains { $0.session.role == .windowApplication }
    guard !phone, hiddenWindow == nil else { return }
    guard let provider = UIApplication.shared.delegate as? ExpoReactNativeFactoryProvider, let factory = provider.reactNativeFactory else {
      NSLog("[carplay] no React Native factory: the car shows the map, without guidance")
      return
    }
    let window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(withModuleName: provider.reactNativeFactoryModuleName, in: window, initialProperties: nil, launchOptions: nil)
    hiddenWindow = window
    if let root = window.rootViewController?.view {
      root.frame = UIScreen.main.bounds
      root.alpha = 0
      root.isUserInteractionEnabled = false
      carWindow.insertSubview(root, at: 0)
    }
  }

  /// The view controller React Native started in for the car, once; nil when the phone came first.
  @objc public static func takeRootViewController() -> UIViewController? {
    guard let window = hiddenWindow else { return nil }
    hiddenWindow = nil
    let controller = window.rootViewController
    window.rootViewController = nil
    controller?.view.removeFromSuperview()
    controller?.view.alpha = 1
    controller?.view.isUserInteractionEnabled = true
    return controller
  }
}
