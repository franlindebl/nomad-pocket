// Starting the app from the car. Expo starts React Native when the phone's window scene connects
// (ExpoAppSceneDelegate). Opened from CarPlay with the phone locked or the app not running, only
// the CarPlay scene connects, so JS (guidance, routes, voice, the data behind the lists) never
// started. Here React Native starts into a window no screen shows; when the phone scene connects
// later, its SceneDelegate (rewritten by plugins/with-carplay.js) adopts that root view controller
// instead of starting a second copy of the app.
internal import Expo
import React
import UIKit

@objc(NomadCarPlayBoot)
public final class CarPlayBoot: NSObject {
  private static var hiddenWindow: UIWindow?

  static func ensureReactNative() {
    let phone = UIApplication.shared.connectedScenes.contains { $0.session.role == .windowApplication }
    guard !phone, hiddenWindow == nil else { return }
    guard let provider = UIApplication.shared.delegate as? ExpoReactNativeFactoryProvider, let factory = provider.reactNativeFactory else {
      NSLog("[carplay] no React Native factory: the car shows the map, without guidance")
      return
    }
    let window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(withModuleName: provider.reactNativeFactoryModuleName, in: window, initialProperties: nil, launchOptions: nil)
    hiddenWindow = window
  }

  /// The view controller React Native started in for the car, once; nil when the phone came first.
  @objc public static func takeRootViewController() -> UIViewController? {
    guard let window = hiddenWindow else { return nil }
    hiddenWindow = nil
    let controller = window.rootViewController
    window.rootViewController = nil
    return controller
  }
}
