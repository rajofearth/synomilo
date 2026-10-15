package com.rajofearth.synomilo

import android.content.Intent
import android.os.Bundle
import androidx.appcompat.app.AppCompatDelegate

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
    /**
     * THE REASON THE APP ONLY FOLLOWED THE SYSTEM THEME AFTER A RELAUNCH.
     *
     * `MainActivity` declares `uiMode` in `android:configChanges`, so Android does
     * NOT recreate the activity when the system theme flips - it relies on the app
     * handling `onConfigurationChanged`. React Native's `Appearance` module on
     * Android derives the colour scheme from the **AppCompat night mode**, and
     * that mode is only ever populated when the app opts into AppCompat's
     * DayNight handling. Without this call it keeps whatever mode the activity was
     * created with, so `Appearance` emits one correct value at launch and then
     * never changes.
     *
     * Symptom: right theme on a cold start, stale until the process restarts -
     * which matches exactly "I have to relaunch the app to get it to switch".
     *
     * Proven with an instrumentation probe: the native `appearanceChanged` event
     * reached `Appearance` (`getColorScheme()` correctly returned the new value)
     * while the component calling `useColorScheme()` never re-rendered.
     */
    AppCompatDelegate.setDefaultNightMode(AppCompatDelegate.MODE_NIGHT_FOLLOW_SYSTEM)

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