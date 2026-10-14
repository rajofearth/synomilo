import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider
import UserNotifications

@main
class AppDelegate: UIResponder, UIApplicationDelegate {

   var window: UIWindow?
  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {


    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()
 
    reactNativeDelegate = delegate
    reactNativeFactory = factory

    // NOTE: `@react-native-firebase/messaging` sets itself as the
    // UNUserNotificationCenter delegate and installs its own
    // `application(_:didReceiveRemoteNotification:fetchCompletionHandler:)` through App
    // Delegate swizzling (no `FirebaseAppDelegateProxyEnabled` key in Info.plist means
    // swizzling is ON), so the app declares neither.
    //
    // The PushKit / CallKit registration that used to sit here
    // (`registerForVoIPPushes()`) is gone with
    // that package. Incoming calls arrive over FCM and
    // are rendered by notifee + `IncomingCallActivity.kt` / the notifee foreground
    // handlers in `App.tsx`.

        window = UIWindow(frame: UIScreen.main.bounds)

        factory.startReactNative(
      withModuleName: "sampleapp",
      in: window,
      launchOptions: launchOptions
    )

    return true
  }

   // MARK: - Standard APNs Token Methods

  func application(
    _ application: UIApplication,
    didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
  ) {
    print("⚡️[AppDelegate] didRegisterForRemoteNotificationsWithDeviceToken deviceToken => \(deviceToken)")
  }

  func application(
    _ application: UIApplication,
    didFailToRegisterForRemoteNotificationsWithError error: Error
  ) {
    print("⚡️[AppDelegate] didFailToRegisterForRemoteNotificationsWithError => \(error)")
  }

}
class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
