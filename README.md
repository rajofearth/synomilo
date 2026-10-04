
<p align="center">
  <img alt="CometChat" src="https://assets.cometchat.io/website/images/logos/banner.png">
</p>

# React Native Sample App with Push Notifications by CometChat

This is a reference application showcasing the integration of [CometChat's React Native UI Kit](https://www.cometchat.com/docs/ui-kit/react-native/5.0/overview) in a React Native project. It demonstrates how to implement real-time messaging and voice/video calling features with ease.

<div style="display: flex; align-items: center; justify-content: center">
   <img src="../../screenshots/overview_cometchat_screens.png" />
</div>


## Prerequisites

Sign up for a [CometChat](https://app.cometchat.com/) account to obtain your app credentials: _`App ID`_, _`Region`_, and _`Auth Key`_

- **Node.js** 18 or higher
- **React Native** Version 0.77 or later (up to the latest version) 

**iOS**
- XCode
- Pod (CocoaPods) for iOS
- An iOS device or emulator with iOS 12.0 or above.
- Ensure that you have configured the provisioning profile in Xcode to run the app on a physical device.

**Android**
- Android Studio
- Android device or emulator with Android version 5.0 or above.


## Installation

1. Clone the repository:
   ```sh
   git clone https://github.com/cometchat/cometchat-uikit-react-native.git
   ```

1. Change into the specific app's directory (e.g., SampleAppWithPushNotifications).
   ```sh
     cd examples/SampleAppWithPushNotifications
   ```
   
1. Run `npm install` to install the dependencies.

1. `[Optional]` Configure CometChat credentials:
    - Open the `AppConstants.tsx` file located at `examples/SampleApp/src/utils/AppConstants.tsx` and enter your CometChat _`appId`_, _`region`_, and _`authKey`_:
      ```ts
      export const AppConstants = {
          appId: 'YOUR_APP_ID',
          authKey: 'YOUR_AUTH_KEY',
          region: 'REGION',
          //other properties
      }
      ```

1. Push Notification Setup guide
   - APNs
      - Follow our [APNs integration](https://www.cometchat.com/docs/notifications/push-integration#add-apns-credentials).
   
   - FCM
      - Go to the [Firebase Console](https://console.firebase.google.com/) and create a project.
      - Add your Android app to the Firebase project and download the `google-services.json` file.
      - Place the `google-services.json` file in the `SampleAppWithPushNotification/android/app` directory of your project.

   - CometChat Push Notification 
      - Go to the [Notification Documentation](https://www.cometchat.com/docs/notifications/push-integration) and follow integration steps.

1. Update the `fcmProviderId` & `apnProviderId` from the step 6 in
      ```ts
      export const AppConstants = {
         fcmProviderId: '',
         apnProviderId: '',
      }
      ```


1. For iOS, install dependencies after navigating to ios:
   ```sh
    cd ios
    pod install
   ```

1. Run the app on a device or emulator from the repo root.
   ```sh
    npm start
    npm run android
    npm run ios
   ```


## Help and Support

For issues running the project or integrating with our UI Kits, consult our [documentation](https://www.cometchat.com/docs/ui-kit/react-native/5.0/getting-started) or create a [support ticket](https://help.cometchat.com/hc/en-us). You can also access real-time support via the [CometChat Dashboard](http://app.cometchat.com/).