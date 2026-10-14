package com.rajofearth.synomilo

import android.animation.ValueAnimator
import android.app.Activity
import android.app.NotificationManager
import android.content.Intent
import android.graphics.Typeface
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.text.TextUtils
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.view.animation.AccelerateDecelerateInterpolator
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.content.ContextCompat

/**
 * Lock-screen incoming-call UI.
 *
 * This exists because `MainActivity` deliberately has no `showWhenLocked` /
 * `turnScreenOn`: pointing the notification's full-screen intent at it produced a
 * keyguard-obscured React Native screen with no Accept/Decline on it. This activity
 * is a plain `Activity` so it can draw and be actionable over the keyguard even when
 * the JS runtime has never been booted.
 *
 * It does not talk to the network. Accept and Decline hand the decision to
 * `MainActivity` as extras, which the RN layer consumes through `CallIntentModule`.
 * Accept has to go through the app anyway (microphone permission + WebRTC); Decline
 * going through the app is a deliberate trade-off - it brings the UI forward - and is
 * documented rather than hidden.
 *
 * ## Where the call actually comes from
 *
 * Notifee does NOT put the notification payload in this activity's intent. Verified
 * against the bundled core AAR (`app.notifee.core.NotificationManager`#buildBuilder,
 * the setFullScreenIntent branch): the launch intent is `new Intent(context, clazz)`
 * with flags, and `putExtra("notification", notification.toBundle())` is reached only
 * inside `if (mainComponent != null)`. A `fullScreenAction` with no `mainComponent`
 * therefore launches this activity with NO extras at all. Reading `callerName` out of
 * the intent - which this class used to do, as its only source - returned null every
 * single time, which is why the ring screen read "Unknown" on every call.
 *
 * The payload is recovered from the posted notification instead. Notifee copies the
 * JS `data` object into the Notification's extras via
 * `NotificationCompat.Builder.setExtras(dataBundle)`, and
 * `NotificationManager.getActiveNotifications()` hands those extras back. The
 * ringing notification is identified by `data.type == "call"`, and its absence is
 * meaningful: see [resolve].
 *
 * ## Monochrome only
 *
 * Every colour comes from res/values/colors.xml, which mirrors the dark scheme in
 * src/theme/paperTheme.ts. All of them are achromatic (R == G == B). Nothing in this
 * file uses the framework `Button` widget: its default background, its all-caps label
 * and its elevation are what made the previous version of this screen read as a
 * system dialog rather than as the app.
 */
class IncomingCallActivity : Activity() {

    private val handler = Handler(Looper.getMainLooper())
    private var finished = false
    private var callerName: String = ""
    private var callType: String = "audio"
    private var callId: String? = null
    private var ringExpiresAt: Long = 0L
    private var started = false
    private var pulse: ValueAnimator? = null

    private val autoDismiss: Runnable = Runnable { closeWithoutAction() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        showOverLockScreen()

        // Re-order-to-front with a dismiss marker: the notification declined (or a
        // terminal push arrived) while this screen was up.
        if (intent.getStringExtra(CallIntent.EXTRA_SURFACE) == CallIntent.SURFACE_DISMISS) {
            finish()
            return
        }

        val resolved = resolve()
        if (!resolved) {
            // No ringing notification behind this full-screen intent, so either the
            // call is over (declined, cancelled, timed out - the terminal push
            // calls `dismissRingScreen()`, which is a no-op precisely because this
            // activity did not exist yet) or the caller has not got far enough.
            //
            // Those two are indistinguishable from in here, and picking wrong is bad
            // in both directions: finishing instantly refuses to draw when the user
            // tapped the notification body a few hundred milliseconds earlier.
            // Re-check briefly, then decide.
            if (!resolveAfterSettling()) {
                finish()
                return
            }
        }

        setContentView(buildContent())
        armAutoDismiss()
    }

    override fun onNewIntent(newIntent: Intent) {
        super.onNewIntent(newIntent)
        setIntent(newIntent)
        if (newIntent.getStringExtra(CallIntent.EXTRA_SURFACE) == CallIntent.SURFACE_DISMISS) {
            closeWithoutAction()
            return
        }
        if (!resolve()) {
            closeWithoutAction()
            return
        }
        setContentView(buildContent())
        // onNewIntent can arrive while the activity is already started, in which
        // case onStart will not run again for the freshly built tree.
        if (started) {
            pulse?.start()
        }
        armAutoDismiss()
    }

    override fun onStart() {
        // onStart/onStop, not onResume/onPause: pulling the notification shade
        // down over this activity pauses it, and onPause would then report "not
        // showing" to CallIntentModule.dismissRingScreen() at the exact moment the
        // user is pressing Decline in the shade. The dismiss would be dropped and
        // the ring screen would survive the decline.
        super.onStart()
        started = true
        RingScreenState.showing = true
        pulse?.start()
    }

    override fun onStop() {
        started = false
        RingScreenState.showing = false
        pulse?.cancel()
        super.onStop()
    }

    override fun onDestroy() {
        RingScreenState.showing = false
        pulse?.cancel()
        pulse = null
        handler.removeCallbacks(autoDismiss)
        super.onDestroy()
    }

    /**
     * Fills in callerName / callType / callId, preferring the intent extras (the
     * hand-off path used when something in the app re-opens this screen) and
     * falling back to the posted ringing notification.
     *
     * Returns false only when there is neither an intent payload nor a live
     * `call:*` notification - i.e. this screen has nothing real to ring for.
     */
    private fun resolve(): Boolean {
        val fromIntent = intent.getStringExtra(CallIntent.EXTRA_CALL_ID)
        val fromNotification = liveRingPayload()

        if (fromIntent.isNullOrEmpty() && fromNotification == null) {
            return false
        }

        callId = fromIntent?.takeIf { it.isNotEmpty() } ?: fromNotification?.callId
        callerName = intent.getStringExtra(CallIntent.EXTRA_CALLER_NAME)?.takeIf { it.isNotEmpty() }
            ?: fromNotification?.callerName
            ?: ""
        callType = intent.getStringExtra(CallIntent.EXTRA_MEDIA_TYPE)?.takeIf { it.isNotEmpty() }
            ?: fromNotification?.callType
            ?: "audio"
        ringExpiresAt = intent.getLongExtra(CallIntent.EXTRA_RING_EXPIRES_AT, 0L)
            .takeIf { it > 0L }
            ?: fromNotification?.expiresAt
            ?: 0L
        return true
    }

    private data class RingPayload(
        val callId: String,
        val callerName: String,
        val callType: String,
        val expiresAt: Long,
    )

    /**
     * Polls [resolve] for a short window before giving up on a notification that
     * may simply not have landed yet.
     *
     * Blocks the launch briefly. That is acceptable here: this activity has no
     * content view yet, so nothing is visible, and the alternative is guessing
     * between "the call is over" and "the caller is still catching up".
     */
    private fun resolveAfterSettling(): Boolean {
        val deadline = SystemClock.uptimeMillis() + RESOLVE_GRACE_MS
        while (SystemClock.uptimeMillis() < deadline) {
            SystemClock.sleep(RESOLVE_POLL_MS)
            if (resolve()) return true
        }
        return false
    }

    /**
     * The ringing notification currently on screen, read straight out of the
     * notification extras.
     *
     * Notifee's builder calls `setExtras(<the JS `data` bundle>)`, so the keys land
     * at the top level of `Notification.extras`. `data` is also probed as a nested
     * bundle because that is how the same payload is shaped when it reaches JS.
     */
    private fun liveRingPayload(): RingPayload? = try {
        val manager = getSystemService(NotificationManager::class.java)
        val active = manager?.activeNotifications.orEmpty()
        // Matched on the payload rather than on the notification id: the ringing
        // notification is the one whose `data.type` is "call", and the ongoing-call
        // notification - same channel family, different lifetime - carries
        // "ongoing". StatusBarNotification.getId() is deprecated and is not worth
        // depending on here.
        active.firstNotNullOfOrNull { sbn ->
            val extras = sbn.notification?.extras ?: return@firstNotNullOfOrNull null
            val data = extras.getBundle("data") ?: extras
            if (data.getString("type") != CALL_DATA_TYPE) {
                return@firstNotNullOfOrNull null
            }
            val id = data.getString("callId")?.takeIf { it.isNotEmpty() }
                ?: return@firstNotNullOfOrNull null
            RingPayload(
                callId = id,
                callerName = data.getString("callerName")?.takeIf { it.isNotEmpty() } ?: "",
                callType = data.getString("callType")?.takeIf { it == "video" } ?: "audio",
                expiresAt = data.getString("ringExpiresAt")?.toLongOrNull() ?: 0L,
            )
        }
    } catch (error: Throwable) {
        null
    }

    @Suppress("DEPRECATION")
    private fun showOverLockScreen() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED)
            window.addFlags(WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)
        }
        // Do NOT add FLAG_DISMISS_KEYGUARD: on a secure lock screen it silently does
        // nothing, and it is the reason some OEMs treat FSI apps as lock-screen bypass.
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        window.setBackgroundDrawableResource(R.color.call_background)
    }

    /**
     * Belt and braces: if the notification is never dismissed (Play drew its own, or
     * the terminal push was lost) this screen must not become a permanent modal. The
     * server's ring window is 60s; give it that plus a small grace period.
     */
    private fun armAutoDismiss() {
        handler.removeCallbacks(autoDismiss)
        val timeoutMs =
            if (ringExpiresAt > 0L) (ringExpiresAt - System.currentTimeMillis() + 10_000L)
                .coerceIn(5_000L, 90_000L)
            else 60_000L
        handler.postDelayed(autoDismiss, timeoutMs)
    }

    private fun closeWithoutAction() {
        if (finished) return
        finished = true
        finish()
    }

    private fun handOff(action: String) {
        if (finished) return
        finished = true
        handler.removeCallbacks(autoDismiss)
        val target = Intent(this, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            putExtra(CallIntent.EXTRA_SURFACE, CallIntent.SURFACE_INCOMING_CALL)
            putExtra(CallIntent.EXTRA_CALL_ACTION, action)
            putExtra(CallIntent.EXTRA_CALL_ID, callId)
            putExtra(CallIntent.EXTRA_CALLER_NAME, callerName)
            putExtra(CallIntent.EXTRA_MEDIA_TYPE, callType)
        }
        startActivity(target)
        finish()
    }

    // ---------------------------------------------------------------- layout --

    private fun buildContent(): View {
        // onNewIntent rebuilds the tree; the previous pulse animator would otherwise
        // keep running against a detached view.
        pulse?.cancel()
        pulse = null

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(color(R.color.call_background))
            setPadding(dp(24), dp(40), dp(24), dp(40))
        }

        root.addView(
            buildBody(),
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                0,
                1f,
            ),
        )
        root.addView(buildActions())

        return root
    }

    private fun buildBody(): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER
        addView(buildEyebrow())
        addView(
            buildMonogram(),
            LinearLayout.LayoutParams(dp(148), dp(148)).apply { topMargin = dp(28) },
        )
        addView(buildName())
        addView(buildStateLine())
    }

    private fun buildEyebrow(): TextView = TextView(this).apply {
        text = getString(R.string.incoming_call_generic).uppercase()
        setTextColor(color(R.color.call_on_surface_variant))
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
        letterSpacing = 0.18f
        gravity = Gravity.CENTER
    }

    private fun buildName(): TextView = TextView(this).apply {
        // With a real name this is the headline. Without one it is gone entirely -
        // the eyebrow above is already saying "Incoming call", and printing the
        // literal word "unknown" as a 28sp display name is not information.
        text = callerName
        visibility = if (callerName.isEmpty()) View.GONE else View.VISIBLE
        setTextColor(color(R.color.call_on_surface))
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 28f)
        typeface = Typeface.DEFAULT_BOLD
        gravity = Gravity.CENTER
        maxLines = 2
        ellipsize = TextUtils.TruncateAt.END
        setPadding(0, dp(24), 0, 0)
    }

    private fun buildStateLine(): TextView = TextView(this).apply {
        text = if (callerName.isEmpty()) {
            getString(
                if (callType == "video") R.string.incoming_video_call
                else R.string.incoming_voice_call
            )
        } else {
            ""
        }
        visibility = if (text.isNullOrEmpty()) View.GONE else View.VISIBLE
        setTextColor(color(R.color.call_on_surface_variant))
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
        gravity = Gravity.CENTER
        setPadding(0, dp(8), 0, 0)
    }

    /**
     * A monogram in the app's circle language: the same `UserAvatar` initials
     * treatment the in-app overlay uses, with the pulsing outline ring from
     * `IncomingCallOverlay`'s `pulseRing` reproduced natively so the background
     * path animates identically to the foreground one.
     */
    private fun buildMonogram(): View {
        val size = dp(148)
        val ring = dp(2)
        val diameter = size - ring * 2

        return FrameLayout(this).apply {
            val container = this
            pulse = ValueAnimator.ofFloat(1f, 1.06f).apply {
                duration = 900L
                repeatCount = ValueAnimator.INFINITE
                repeatMode = ValueAnimator.REVERSE
                interpolator = AccelerateDecelerateInterpolator()
                addUpdateListener {
                    val scale = it.animatedValue as Float
                    container.scaleX = scale
                    container.scaleY = scale
                }
            }

            addView(
                View(this@IncomingCallActivity).apply {
                    background = circleBackground(
                        null,
                        color(R.color.call_outline),
                        strokeWidth = ring,
                    )
                },
                FrameLayout.LayoutParams(size, size).apply { gravity = Gravity.CENTER },
            )

            addView(
                TextView(this@IncomingCallActivity).apply {
                    text = initialsFor(callerName)
                    gravity = Gravity.CENTER
                    setTextColor(color(R.color.call_on_primary_container))
                    setTextSize(TypedValue.COMPLEX_UNIT_SP, 44f)
                    typeface = Typeface.DEFAULT_BOLD
                    background = circleBackground(color(R.color.call_primary_container), null, dp(0))
                },
                FrameLayout.LayoutParams(diameter, diameter).apply { gravity = Gravity.CENTER },
            )
        }
    }

    private fun buildActions(): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER

        addView(
            buildPill(
                label = getString(R.string.call_action_decline),
                filled = false,
                onPress = { handOff(CallIntent.ACTION_DECLINE) },
            ),
            LinearLayout.LayoutParams(0, dp(64), 1f).apply {
                marginEnd = dp(8)
                gravity = Gravity.CENTER_VERTICAL
            },
        )
        addView(
            buildPill(
                label = getString(R.string.call_action_accept),
                filled = true,
                onPress = { handOff(CallIntent.ACTION_ACCEPT) },
            ),
            LinearLayout.LayoutParams(0, dp(64), 1f).apply {
                marginStart = dp(8)
                gravity = Gravity.CENTER_VERTICAL
            },
        )
    }

    /**
     * A flat, corner-rounded label with a hairline border. Deliberately not
     * `android.widget.Button`: AppCompat's button background, its all-caps label
     * and its state-list elevation are what made the previous ring screen read as
     * a system dialog instead of as this app.
     */
    private fun buildPill(label: String, filled: Boolean, onPress: () -> Unit): TextView =
        TextView(this).apply {
            text = label
            isAllCaps = false
            letterSpacing = 0.04f
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(
                color(if (filled) R.color.call_on_primary else R.color.call_on_surface)
            )
            gravity = Gravity.CENTER
            includeFontPadding = false
            stateListAnimator = null
            background = roundedBackground(
                fill = color(if (filled) R.color.call_primary else R.color.call_surface),
                stroke = if (filled) null else color(R.color.call_outline),
                radius = dp(32),
                strokeWidth = dp(1),
            )
            isClickable = true
            isFocusable = true
            setOnClickListener { onPress() }
        }

    /**
     * Flat background with a null fill or a null stroke meaning "leave it out".
     */
    private fun roundedBackground(
        fill: Int?,
        stroke: Int?,
        radius: Int,
        strokeWidth: Int,
    ): android.graphics.drawable.GradientDrawable =
        android.graphics.drawable.GradientDrawable().apply {
            shape = android.graphics.drawable.GradientDrawable.RECTANGLE
            cornerRadius = radius.toFloat()
            setColor(fill ?: android.graphics.Color.TRANSPARENT)
            if (stroke != null) {
                setStroke(strokeWidth, stroke)
            }
        }

    private fun circleBackground(
        fill: Int?,
        stroke: Int?,
        strokeWidth: Int,
    ): android.graphics.drawable.GradientDrawable =
        android.graphics.drawable.GradientDrawable().apply {
            shape = android.graphics.drawable.GradientDrawable.OVAL
            setColor(fill ?: android.graphics.Color.TRANSPARENT)
            if (stroke != null) {
                setStroke(strokeWidth, stroke)
            }
        }

    /** Port of `initialsFor` in src/utils/avatar.ts, so the ring screen and the app agree. */
    private fun initialsFor(name: String): String {
        val trimmed = name.trim()
        if (trimmed.isEmpty()) return "?"
        val words = trimmed.split(Regex("[\\s._-]+")).filter { it.isNotEmpty() }
        if (words.isEmpty()) return trimmed.take(2).uppercase()
        if (words.size == 1) return words[0].take(2).uppercase()
        return (words.first().take(1) + words.last().take(1)).uppercase()
    }

    private fun color(res: Int): Int = ContextCompat.getColor(this, res)

    private fun dp(value: Int): Int =
        TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP,
            value.toFloat(),
            resources.displayMetrics,
        ).toInt()

    private companion object {
        /**
         * `data.type` of a ringing notification. Must match `type: 'call'` in
         * `showIncomingCallNotification`, src/notifications/callNotifications.ts.
         */
        const val CALL_DATA_TYPE = "call"

        const val RESOLVE_GRACE_MS = 1200L
        const val RESOLVE_POLL_MS = 200L
    }
}