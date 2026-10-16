package com.rajofearth.synomilo

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/** Own-package native modules that are not autolinkable. */
@Suppress("DEPRECATION")
class CallPackage : ReactPackage {

    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
        listOf(
            CallIntentModule(reactContext),
            CallAudioModule(reactContext),
            // Default-network changes, so a Wi-Fi -> LTE handover during a call can
            // trigger a bounded ICE restart. Needs ACCESS_NETWORK_STATE in the
            // manifest.
            CallNetworkModule(reactContext),
            // App lock: biometric gate + FLAG_SECURE, and the encrypted store that
            // holds the session token and the PIN verifier.
            BiometricGateModule(reactContext),
            SecureStoreModule(reactContext),
        )

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
        emptyList()
}