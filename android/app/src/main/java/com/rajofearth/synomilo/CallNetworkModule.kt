package com.rajofearth.synomilo

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * Tells JS when the device's default network changes identity.
 *
 * ## Why this exists
 *
 * A call on a phone does not stay on the network it started on. Walking out of Wi-Fi
 * range onto LTE, getting into a lift, or joining a VPN all replace the default
 * `Network`, which changes this process's IP address. ICE gathered its candidates
 * once, at setup, and this `react-native-webrtc` does not expose
 * `continualGatheringPolicy` (`lib/typescript/RTCPeerConnection.d.ts:31-37`), so
 * gathering is `gather_once`: after a handover the candidates both sides are holding
 * describe an interface that no longer exists. The connection cannot come back on
 * its own, and there is no user-visible event to hang a recovery off either - ICE
 * just sits in `disconnected` until its consent-freshness timer expires, tens of
 * seconds later.
 *
 * So the trigger has to come from the platform. This reports the identity of the
 * default network, and `WebRTCCallScreen` spends a bounded ICE restart when it
 * changes.
 *
 * ## Why the *identity* rather than a boolean
 *
 * `registerDefaultNetworkCallback` fires `onAvailable`/`onLost` in an unspecified
 * order when the default network is replaced: typically `onAvailable(new)` and then
 * `onLost(old)`. Emitting each callback's own network would report the handover
 * twice, as new-then-none, and the second one is a lie - there is a perfectly good
 * network there. So this module tracks the current network itself and emits only
 * when *the current identity* actually changes. A duplicate callback for the network
 * that is already current is not an event at all.
 *
 * `onCapabilitiesChanged` is deliberately not treated as a change: the transports
 * on a network can change while its identity - and therefore its IP - does not, and
 * that is not a handover.
 *
 * Needs `android.permission.ACCESS_NETWORK_STATE`, which is not a runtime permission
 * but is not implied by `INTERNET`. It is declared in AndroidManifest.xml.
 *
 * Scoped to the foreground of the call: [start] is called when the call screen mounts
 * and [stop] when it goes away, so this never holds a callback registration for the
 * life of the process.
 */
class CallNetworkModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "CallNetwork"

    private fun connectivity(): ConnectivityManager? =
        reactApplicationContext.getSystemService(Context.CONNECTIVITY_SERVICE)
            as? ConnectivityManager

    private var callback: ConnectivityManager.NetworkCallback? = null

    /**
     * The current default network's identity, or null when there is none. Guarded by
     * the bridge's UI queue: [emit] reads it to decide whether anything changed, and
     * every callback runs on the thread the callback was registered from.
     */
    @Volatile private var currentKey: String? = null

    private val listener = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            setCurrent(network.toString())
        }

        override fun onLost(network: Network) {
            // Only the current one going away means the device is now offline. A
            // handover also delivers `onLost(old)` *after* `onAvailable(new)`, and
            // clearing the current network then would be reporting a disconnection
            // that did not happen.
            if (network.toString() == currentKey) {
                setCurrent(null)
            }
        }
    }

    /** Emits only on a real change of identity, so JS sees each handover once. */
    private fun setCurrent(key: String?) {
        if (key == currentKey) {
            return
        }
        currentKey = key
        emit(key)
    }

    private fun emit(key: String?) {
        val payload = Arguments.createMap().apply {
            putString("networkKey", key)
            putBoolean("connected", key != null)
        }
        val reactContext = reactApplicationContext
        if (!reactContext.hasActiveReactInstance()) {
            return
        }
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(EVENT_NETWORK_CHANGED, payload)
    }

    /**
     * Begin watching the default network. Idempotent, so a re-render cannot register
     * a second callback and double every event.
     */
    @ReactMethod
    fun start(promise: Promise) {
        val cm = connectivity()
        if (cm == null) {
            promise.resolve(false)
            return
        }
        if (callback != null) {
            // Already watching, but re-report so a caller that started while the
            // screen remounted still has a baseline.
            emit(currentKey)
            promise.resolve(true)
            return
        }
        try {
            // API 24+, and minSdk is 24. `registerDefaultNetworkCallback` is the
            // one that follows the system default across changes, which is what a
            // call cares about; a request-scoped callback would fire for networks
            // this app never ends up using.
            cm.registerDefaultNetworkCallback(listener)
            callback = listener
            currentKey = runCatching { cm.activeNetwork?.toString() }.getOrNull()
            // Reported unconditionally, and that is the point: JS treats its first
            // observation as a baseline rather than a handover, so without this the
            // first genuine network change - the Wi-Fi -> LTE handover this whole
            // module exists for - would be swallowed as "nothing to compare against".
            emit(currentKey)
            promise.resolve(true)
        } catch (error: Throwable) {
            // Missing permission, or too many registrations. Not fatal: the ICE
            // state machine still recovers on `iceConnectionState` alone.
            currentKey = null
            promise.resolve(false)
        }
    }

    @ReactMethod
    fun stop(promise: Promise) {
        unregister()
        promise.resolve(true)
    }

    private fun unregister() {
        val registered = callback ?: return
        callback = null
        currentKey = null
        runCatching { connectivity()?.unregisterNetworkCallback(registered) }
    }

    /** Required by `NativeEventEmitter`; this module has no listener bookkeeping. */
    @ReactMethod
    fun addListener(eventName: String) = Unit

    /** Required by `NativeEventEmitter`; see [addListener]. */
    @ReactMethod
    fun removeListeners(count: Int) = Unit

    override fun invalidate() {
        // The bridge is going away. Leaving the callback registered holds a
        // registration against this process for the rest of its life and would keep
        // emitting into a dead context.
        unregister()
        super.invalidate()
    }

    private companion object {
        const val EVENT_NETWORK_CHANGED = "CallNetwork:changed"
    }
}
