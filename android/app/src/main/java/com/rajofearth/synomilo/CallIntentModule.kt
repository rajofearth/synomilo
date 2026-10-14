package com.rajofearth.synomilo

import android.content.Intent
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Contract between the native ring screen (`IncomingCallActivity`) and the JS layer.
 *
 * The ringing activity deliberately has no network access: it draws Accept/Decline
 * and then hands the decision to `MainActivity`, which boots React Native. Without
 * this module that intent is invisible to JS on a cold start, which is why accepting
 * a call from the lock screen used to silently do nothing.
 */
object CallIntent {
    const val EXTRA_SURFACE = "surface"
    const val EXTRA_CALL_ACTION = "callAction"
    const val EXTRA_CALL_ID = "callId"
    const val EXTRA_CALLER_NAME = "callerName"
    const val EXTRA_MEDIA_TYPE = "mediaType"
    const val EXTRA_RING_EXPIRES_AT = "ringExpiresAt"

    const val SURFACE_INCOMING_CALL = "incoming-call"
    const val SURFACE_DISMISS = "dismiss"
    const val ACTION_ACCEPT = "accept"
    const val ACTION_DECLINE = "decline"
}

/**
 * Whether the lock-screen ring UI is actually on display right now.
 *
 * Lets `dismissRingScreen()` be a genuine no-op instead of starting a one-frame
 * black activity to say "nothing to dismiss" - which would flash on every decline
 * and every accept, because those already finish the ring screen themselves.
 */
object RingScreenState {
    @Volatile
    var showing: Boolean = false
}

/**
 * A single-slot mailbox for the last incoming-call intent. Written by
 * `MainActivity.onCreate`/`onNewIntent`, drained by JS exactly once so a JS-side
 * re-render or a React remount cannot replay an Accept that already happened.
 */
object CallIntentMailbox {
    @Volatile
    private var pending: Intent? = null

    fun publish(intent: Intent?) {
        if (intent?.getStringExtra(CallIntent.EXTRA_SURFACE) == CallIntent.SURFACE_INCOMING_CALL) {
            pending = intent
        }
    }

    fun take(): Intent? {
        val value = pending
        pending = null
        return value
    }
}

class CallIntentModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "CallIntent"

    @ReactMethod
    fun takeLaunchIntent(promise: Promise) {
        val intent = CallIntentMailbox.take()
        val map = Arguments.createMap()
        if (intent == null) {
            promise.resolve(null)
            return
        }
        map.putString("callAction", intent.getStringExtra(CallIntent.EXTRA_CALL_ACTION))
        map.putString("callId", intent.getStringExtra(CallIntent.EXTRA_CALL_ID))
        map.putString("callerName", intent.getStringExtra(CallIntent.EXTRA_CALLER_NAME))
        map.putString("mediaType", intent.getStringExtra(CallIntent.EXTRA_MEDIA_TYPE))
        promise.resolve(map)
    }

    /**
     * Finishes IncomingCallActivity if it is showing.
     *
     * Called when the call reaches a terminal state - a decline from the
     * notification, or the terminal push once the backend ships it - so the lock
     * screen ring UI cannot outlive the ring itself. Uses FLAG_ACTIVITY_REORDER_TO
     * FRONT rather than finishAndRemoveTask so the app's own task is untouched: the
     * ring screen has its own taskAffinity, and tearing that down must not disturb
     * MainActivity.
     */
    @ReactMethod
    fun dismissRingScreen(promise: Promise) {
        if (!RingScreenState.showing) {
            promise.resolve(false)
            return
        }
        try {
            val current = reactApplicationContext.currentActivity
            val flags =
                Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP or
                    Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
            if (current == null) {
                // No foreground activity to start the intent from. Best effort:
                // send it to the application context and let the system resolve it.
                val intent = Intent(reactApplicationContext, IncomingCallActivity::class.java)
                intent.addFlags(flags)
                intent.putExtra(CallIntent.EXTRA_SURFACE, CallIntent.SURFACE_DISMISS)
                reactApplicationContext.startActivity(intent)
                promise.resolve(false)
                return
            }
            val intent = Intent(current, IncomingCallActivity::class.java)
            intent.addFlags(flags and Intent.FLAG_ACTIVITY_NEW_TASK.inv())
            intent.putExtra(CallIntent.EXTRA_SURFACE, CallIntent.SURFACE_DISMISS)
            current.startActivity(intent)
            promise.resolve(true)
        } catch (error: Throwable) {
            promise.resolve(false)
        }
    }

    /**
     * Brings the app to the front with a fresh task intent.
     *
     * The notification's Accept button carries no `launchActivity`, so Notifee
     * cannot open the app for us: it dispatches a headless JS event, the headless
     * handler stores the pending accept, and then... nothing happened. Tapping
     * Accept while the app was backgrounded silently did nothing. This is the other
     * half of that fix.
     */
    @ReactMethod
    fun openApp(promise: Promise) {
        try {
            val intent = Intent(reactApplicationContext, MainActivity::class.java).apply {
                addFlags(
                    Intent.FLAG_ACTIVITY_NEW_TASK or
                        Intent.FLAG_ACTIVITY_CLEAR_TOP or
                        Intent.FLAG_ACTIVITY_SINGLE_TOP,
                )
            }
            reactApplicationContext.startActivity(intent)
            promise.resolve(true)
        } catch (error: Throwable) {
            promise.resolve(false)
        }
    }
}