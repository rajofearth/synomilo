package com.rajofearth.synomilo

import android.content.Intent
import android.os.Bundle

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
    // REQUIRED for react-native-screens
    super.onCreate(null)
        // A cold start launched by IncomingCallActivity carries the Accept/Decline
        // decision. Publish it before the JS bridge exists so takeLaunchIntent()
        // can find it the moment the bundle has run.
        CallIntentMailbox.publish(intent)
  }

    /**
     * MainActivity is singleTask, so every launch from the ring screen while the app
     * is already alive lands here rather than in onCreate. Without this the Accept
     * button on the lock screen did nothing at all while the app was running.
     */
    override fun onNewIntent(newIntent: Intent) {
        super.onNewIntent(newIntent)
        setIntent(newIntent)
        CallIntentMailbox.publish(newIntent)
    }


  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "sampleapp"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)
}