package com.rajofearth.synomilo

import android.app.Activity
import android.content.pm.PackageManager
import android.os.Build
import android.view.WindowManager
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.Lifecycle
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import java.util.concurrent.Executor
import java.util.concurrent.atomic.AtomicBoolean

/**
 * The biometric half of the app lock.
 *
 * ## What leaves this class
 *
 * Exactly one thing: whether the OS says a human just proved presence. Nothing
 * else. Fingerprint and face templates are captured, matched and stored inside
 * protected hardware (a TEE, or the StrongBox on newer devices); the platform does
 * not expose them to applications, so there is deliberately no code here that
 * reads, hashes, stores or transmits a biometric sample. Android's contract is a
 * verified/not-verified result plus an optional hardware-backed key handle, and
 * this module uses only the former.
 *
 * That is also why no `CryptoObject` is passed. An auth-bound `CryptoObject` cannot
 * be combined with `DEVICE_CREDENTIAL` - `androidx.biometric` rejects that pairing
 * outright - and the device credential is required as a fallback so that a user
 * whose fingerprint sensor stops working is not stranded. Since the data behind
 * this gate is already encrypted at rest under a non-exportable Keystore key (see
 * [SecureStoreModule]), an auth-bound key would add nothing here anyway: it would
 * protect bytes that are already unreadable without the hardware key.
 *
 * ## No hanging promises
 *
 * `BiometricPrompt` can fail in ways that produce no callback at all: an activity
 * that is not a `FragmentActivity`, one that is finishing, one that is not
 * resumed. Every one of those is checked up front and rejected with a specific
 * code, and the in-flight guard below makes sure a second call cannot leave the
 * first promise dangling.
 */
class BiometricGateModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "BiometricGate"

    /**
     * Applies [WindowManager.LayoutParams.FLAG_SECURE] to every activity as it resumes.
     *
     * Without it, the recents-screen snapshot captures whatever was on screen the
     * moment the app went to the background - which for a chat app is message
     * content - and keeps it in a file on disk, readable by anyone who picks up an
     * unlocked phone. The flag has to be set before the activity is paused, and a
     * JS-side call lands far too late to be reliable, so it is applied here
     * instead.
     *
     * It also blocks `adb shell screencap`, screen recording, and casting to an
     * external display. The cost is real and worth stating plainly: the OS
     * screenshot gesture, screen recording and third-party screenshot tools stop
     * working for this app. Every mainstream messenger makes that trade; leaking a
     * conversation to a shoulder-surfer or a backup of the recents file is worse
     * than losing in-app screenshots.
     *
     * This is a [LifecycleEventListener], not an [ActivityEventListener]: the
     * per-activity resume callback it originally hung off
     * (`ActivityEventListener.onActivityResumed`) no longer exists in React Native
     * 0.81, where that interface is `onActivityResult` / `onNewIntent` /
     * `onUserLeaveHint` only and host lifecycle moved to `onHostResume`. Against
     * this version the object literal did not compile at all, so the module never
     * built and consequently the flag was never applied on any device - the exact
     * capture described above was live.
     *
     * `onHostResume` fires once per activity resume, which is what
     * `onActivityResumed` used to do, so the timing guarantee still holds: the flag
     * is in place before every pause, and therefore before the snapshot is taken.
     */
    private val secureWindowListener = object : LifecycleEventListener {
        override fun onHostResume() {
            val activity = reactContext.currentActivity ?: return
            activity.runOnUiThread {
                applyFlag(activity, true)
            }
        }

        override fun onHostPause() = Unit

        override fun onHostDestroy() = Unit
    }

    init {
        reactContext.addLifecycleEventListener(secureWindowListener)
    }

    override fun invalidate() {
        reactContext.removeLifecycleEventListener(secureWindowListener)
        super.invalidate()
    }

    /**
     * Escape hatch for the flag, so the policy lives in one place and could be
     * relaxed without touching native code again. Never called by the app as shipped.
     */
    @ReactMethod
    fun setSecureWindow(enabled: Boolean, promise: Promise) {
        val activity = reactApplicationContext.currentActivity
        if (activity == null) {
            promise.resolve(false)
            return
        }
        activity.runOnUiThread {
            applyFlag(activity, enabled)
            promise.resolve(hasFlag(activity))
        }
    }

    @ReactMethod
    fun isSecureWindowEnabled(promise: Promise) {
        val activity = reactApplicationContext.currentActivity
        promise.resolve(activity != null && hasFlag(activity))
    }

    /**
     * What the device can actually do.
     *
     * Returns a machine-readable `reason` rather than a bare boolean, because the UI
     * reacts differently to "no fingerprint hardware" (offer the app PIN) and
     * "hardware present but nothing enrolled" (offer to enrol, and fall back to the
     * app PIN). Collapsing both to `false` is how people end up staring at an Unlock
     * button that can never work.
     */
    @ReactMethod
    fun getAvailability(promise: Promise) {
        val result = Arguments.createMap()
        try {
            if (!hasBiometricPermission()) {
                // Declared in the manifest and not grantable at runtime: an install
                // that forgot it cannot prompt at all. Reported explicitly so the
                // app goes straight to the PIN instead of showing a dead button.
                result.putBoolean("available", false)
                result.putString("reason", REASON_PERMISSION_MISSING)
                result.putInt("status", BiometricManager.BIOMETRIC_ERROR_UNSUPPORTED)
                result.putBoolean("deviceCredentialAvailable", false)
                promise.resolve(result)
                return
            }

            val manager = BiometricManager.from(reactApplicationContext)
            val status = manager.canAuthenticate(ALLOWED_AUTHENTICATORS)
            result.putInt("status", status)
            result.putBoolean("available", status == BiometricManager.BIOMETRIC_SUCCESS)
            result.putString("reason", reasonFor(status))
            result.putBoolean("deviceCredentialAvailable", deviceCredentialAvailable(manager))
            promise.resolve(result)
        } catch (error: Exception) {
            promise.reject(E_UNAVAILABLE, error.message, error)
        }
    }

    /**
     * Shows the system biometric prompt and resolves with the outcome.
     *
     * Never rejects for an ordinary user action - a cancel resolves with
     * `status: "cancelled"`. Rejection is reserved for the caller having asked for
     * something impossible (no foreground activity), so the UI can tell "you backed
     * out" apart from "this device cannot do that".
     *
     * `negativeLabel` is accepted for API symmetry but is deliberately unused; see
     * the note where the prompt is built.
     */
    @ReactMethod
    fun authenticate(title: String, subtitle: String?, negativeLabel: String?, promise: Promise) {
        val activity = reactApplicationContext.currentActivity
        if (activity == null) {
            promise.reject(E_NO_ACTIVITY, "No foreground activity to host the biometric prompt")
            return
        }
        if (activity !is FragmentActivity) {
            // BiometricPrompt attaches itself as a Fragment. Without a
            // FragmentActivity it has nowhere to live and would simply never
            // appear - a silent hang. Say so instead.
            promise.reject(
                E_NOT_FRAGMENT_ACTIVITY,
                "Host activity is ${activity.javaClass.simpleName}, which is not a FragmentActivity",
            )
            return
        }
        if (activity.isFinishing ||
            (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN_MR2 && activity.isDestroyed)
        ) {
            promise.reject(E_ACTIVITY_GONE, "Host activity is finishing or destroyed")
            return
        }
        if (!activity.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) {
            // Not something the user can act on except by waiting, so the UI should
            // retry on the next resume rather than present a dead end.
            promise.reject(E_ACTIVITY_NOT_RESUMED, "Host activity is not resumed")
            return
        }
        if (!hasBiometricPermission()) {
            promise.reject(E_PERMISSION_MISSING, "USE_BIOMETRIC is not declared in the manifest")
            return
        }
        if (!PROMPT_IN_FLIGHT.compareAndSet(false, true)) {
            // A prompt is already up. Rejecting beats resolving the second call
            // with the first call's result, which would hand out a successful
            // unlock for an authentication the caller never made.
            promise.reject(E_IN_FLIGHT, "A biometric prompt is already showing")
            return
        }

        val settled = AtomicBoolean(false)
        val mainExecutor: Executor = ContextCompat.getMainExecutor(reactApplicationContext)

        activity.runOnUiThread {
            try {
                val manager = BiometricManager.from(reactApplicationContext)
                val status = manager.canAuthenticate(ALLOWED_AUTHENTICATORS)
                if (status != BiometricManager.BIOMETRIC_SUCCESS) {
                    settle(settled, promise) { out ->
                        out.putString("status", STATUS_UNAVAILABLE)
                        out.putString("reason", reasonFor(status))
                        out.putInt("errorCode", status)
                    }
                    PROMPT_IN_FLIGHT.set(false)
                    return@runOnUiThread
                }

                val prompt = BiometricPrompt(
                    activity,
                    mainExecutor,
                    object : BiometricPrompt.AuthenticationCallback() {

                        override fun onAuthenticationSucceeded(
                            result: BiometricPrompt.AuthenticationResult,
                        ) {
                            settle(settled, promise) { out ->
                                out.putString("status", STATUS_SUCCESS)
                                out.putString(
                                    "method",
                                    when (result.authenticationType) {
                                        BiometricPrompt.AUTHENTICATION_RESULT_TYPE_DEVICE_CREDENTIAL -> METHOD_DEVICE_CREDENTIAL
                                        BiometricPrompt.AUTHENTICATION_RESULT_TYPE_BIOMETRIC -> METHOD_BIOMETRIC
                                        else -> METHOD_UNKNOWN
                                    },
                                )
                            }
                            PROMPT_IN_FLIGHT.set(false)
                        }

                        /**
                         * One rejected finger. The prompt stays up and the user gets
                         * another go, so this deliberately does NOT settle the
                         * promise - settling here is what produces the classic
                         * "one bad read logs you out" bug.
                         */
                        override fun onAuthenticationFailed() = Unit

                        override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                            settle(settled, promise) { out ->
                                out.putString("status", statusForError(errorCode))
                                out.putInt("errorCode", errorCode)
                                out.putString("message", errString.toString())
                            }
                            PROMPT_IN_FLIGHT.set(false)
                        }
                    },
                )
                ACTIVE_PROMPT = prompt

                val builder = BiometricPrompt.PromptInfo.Builder()
                    .setTitle(title)
                    .setAllowedAuthenticators(ALLOWED_AUTHENTICATORS)

                if (!subtitle.isNullOrBlank()) {
                    builder.setSubtitle(subtitle)
                }

                /**
                 * Deliberately NOT called: `setNegativeButtonText`.
                 *
                 * When `DEVICE_CREDENTIAL` is among the allowed authenticators,
                 * `BiometricPrompt` throws `IllegalArgumentException` if a negative
                 * button text is also set - the system draws its own "Use PIN"
                 * action instead. Setting one "for accessibility" breaks
                 * authentication outright on every API level this app supports.
                 */
                prompt.authenticate(builder.build())
            } catch (error: Exception) {
                settle(settled, promise) { out ->
                    out.putString("status", STATUS_ERROR)
                    out.putString("message", error.message ?: error.javaClass.simpleName)
                }
                PROMPT_IN_FLIGHT.set(false)
            }
        }
    }

    /**
     * Dismisses a showing prompt.
     *
     * Clears the in-flight flag as well as the prompt itself, so a prompt dismissed
     * by the system while the app was backgrounded - the common "swipe up, do
     * something else" path - does not leave the next unlock attempt permanently
     * rejected as already-in-progress.
     */
    @ReactMethod
    fun cancel() {
        ACTIVE_PROMPT?.cancelAuthentication()
        ACTIVE_PROMPT = null
        PROMPT_IN_FLIGHT.set(false)
    }

    /**
     * Resolves exactly once.
     *
     * A promise that settles twice throws on the JS side, and one that never settles
     * hangs the lock screen forever. The guard is here rather than at each call site
     * because `onAuthenticationError` and `onAuthenticationSucceeded` can both fire
     * for a single presentation on some OEM builds.
     */
    private fun settle(
        settled: AtomicBoolean,
        promise: Promise,
        fill: (WritableMap) -> Unit,
    ) {
        if (!settled.compareAndSet(false, true)) {
            return
        }
        val map = Arguments.createMap()
        fill(map)
        ACTIVE_PROMPT = null
        promise.resolve(map)
    }

    @Suppress("DEPRECATION")
    private fun hasBiometricPermission(): Boolean {
        val permission = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            android.Manifest.permission.USE_BIOMETRIC
        } else {
            android.Manifest.permission.USE_FINGERPRINT
        }
        return reactApplicationContext.checkSelfPermission(permission) ==
            PackageManager.PERMISSION_GRANTED
    }

    private fun deviceCredentialAvailable(manager: BiometricManager): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.R &&
            manager.canAuthenticate(BiometricManager.Authenticators.DEVICE_CREDENTIAL) ==
            BiometricManager.BIOMETRIC_SUCCESS

    private fun applyFlag(activity: Activity, enabled: Boolean) {
        if (enabled) {
            activity.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        } else {
            activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
        }
    }

    private fun hasFlag(activity: Activity): Boolean =
        (activity.window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE) != 0

    private fun reasonFor(status: Int): String = when (status) {
        BiometricManager.BIOMETRIC_SUCCESS -> REASON_OK
        BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE -> REASON_NO_HARDWARE
        BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE -> REASON_HW_UNAVAILABLE
        BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED -> REASON_NONE_ENROLLED
        BiometricManager.BIOMETRIC_ERROR_UNSUPPORTED,
        BiometricManager.BIOMETRIC_ERROR_SECURITY_UPDATE_REQUIRED,
        -> REASON_UNSUPPORTED

        else -> REASON_UNKNOWN
    }

    private fun statusForError(errorCode: Int): String = when (errorCode) {
        BiometricPrompt.ERROR_USER_CANCELED,
        BiometricPrompt.ERROR_NEGATIVE_BUTTON,
        BiometricPrompt.ERROR_CANCELED,
        -> STATUS_CANCELLED

        BiometricPrompt.ERROR_LOCKOUT,
        BiometricPrompt.ERROR_LOCKOUT_PERMANENT,
        -> STATUS_LOCKOUT

        BiometricPrompt.ERROR_NO_BIOMETRICS,
        BiometricPrompt.ERROR_HW_NOT_PRESENT,
        BiometricPrompt.ERROR_HW_UNAVAILABLE,
        BiometricPrompt.ERROR_NO_DEVICE_CREDENTIAL,
        -> STATUS_UNAVAILABLE

        else -> STATUS_ERROR
    }

    companion object {
        private const val E_NO_ACTIVITY = "E_NO_ACTIVITY"
        private const val E_NOT_FRAGMENT_ACTIVITY = "E_NOT_FRAGMENT_ACTIVITY"
        private const val E_ACTIVITY_GONE = "E_ACTIVITY_GONE"
        private const val E_ACTIVITY_NOT_RESUMED = "E_ACTIVITY_NOT_RESUMED"
        private const val E_PERMISSION_MISSING = "E_PERMISSION_MISSING"
        private const val E_IN_FLIGHT = "E_PROMPT_IN_FLIGHT"
        private const val E_UNAVAILABLE = "E_BIOMETRIC_UNAVAILABLE"

        private const val STATUS_SUCCESS = "success"
        private const val STATUS_CANCELLED = "cancelled"
        private const val STATUS_LOCKOUT = "lockout"
        private const val STATUS_UNAVAILABLE = "unavailable"
        private const val STATUS_ERROR = "error"

        private const val METHOD_BIOMETRIC = "biometric"
        private const val METHOD_DEVICE_CREDENTIAL = "deviceCredential"
        private const val METHOD_UNKNOWN = "unknown"

        private const val REASON_OK = "ok"
        private const val REASON_NO_HARDWARE = "noHardware"
        private const val REASON_HW_UNAVAILABLE = "hwUnavailable"
        private const val REASON_NONE_ENROLLED = "noneEnrolled"
        private const val REASON_UNSUPPORTED = "unsupported"
        private const val REASON_UNKNOWN = "unknown"
        private const val REASON_PERMISSION_MISSING = "permissionMissing"

        /**
         * Class 3 (BIOMETRIC_STRONG) plus the device credential.
         *
         * BIOMETRIC_WEAK would admit a face unlock that a photograph can defeat on
         * some hardware; the strong class rules that out. DEVICE_CREDENTIAL is what
         * keeps a user whose fingerprint sensor dies from being locked out of their
         * own messages, so it stays.
         */
        private val ALLOWED_AUTHENTICATORS =
            BiometricManager.Authenticators.BIOMETRIC_STRONG or
                BiometricManager.Authenticators.DEVICE_CREDENTIAL

        private val PROMPT_IN_FLIGHT = AtomicBoolean(false)

        @Volatile
        private var ACTIVE_PROMPT: BiometricPrompt? = null
    }
}