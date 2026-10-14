package com.rajofearth.synomilo

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/**
 * Lock-screen incoming-call UI.
 *
 * This exists because `MainActivity` deliberately has no `showWhenLocked` /
 * `turnScreenOn`: pointing the notification's full-screen intent at it produced a
 * keyguard-obscured React Native screen with no Accept/Decline on it. This activity
 * is a plain `Activity` with a programmatic layout so it can draw and be actionable
 * over the keyguard even when the JS runtime has never been booted.
 *
 * It does not talk to the network. Accept and Decline hand the decision to
 * `MainActivity` as extras, which the RN layer consumes through `CallIntentModule`.
 * Accept has to go through the app anyway (microphone permission + WebRTC); Decline
 * going through the app is a deliberate trade-off - it brings the UI forward - and is
 * documented rather than hidden.
 *
 * Monochrome only. See src/theme/paperTheme.ts: no hue anywhere in this product.
 */
class IncomingCallActivity : Activity() {

    private val handler = Handler(Looper.getMainLooper())
    private var finished = false
    private var callerName = "Unknown"
    private var callType = "audio"

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

        callerName = intent.getStringExtra(CallIntent.EXTRA_CALLER_NAME) ?: "Unknown"
        callType = intent.getStringExtra(CallIntent.EXTRA_MEDIA_TYPE) ?: "audio"

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
        callerName = newIntent.getStringExtra(CallIntent.EXTRA_CALLER_NAME) ?: callerName
        callType = newIntent.getStringExtra(CallIntent.EXTRA_MEDIA_TYPE) ?: callType
        armAutoDismiss()
    }

    override fun onResume() {
        super.onResume()
        RingScreenState.showing = true
    }

    override fun onPause() {
        RingScreenState.showing = false
        super.onPause()
    }

    override fun onDestroy() {
        RingScreenState.showing = false
        handler.removeCallbacks(autoDismiss)
        super.onDestroy()
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
        window.setBackgroundDrawableResource(android.R.color.black)
    }

    /**
     * Belt and braces: if the notification never arrives (Play drew its own, or the
     * terminal push was lost) this screen must not become a permanent modal. The
     * server's ring window is 60s; give it that plus a small grace period.
     */
    private fun armAutoDismiss() {
        handler.removeCallbacks(autoDismiss)
        val expiresAt = intent.getLongExtra(CallIntent.EXTRA_RING_EXPIRES_AT, 0L)
        val timeoutMs =
            if (expiresAt > 0L) (expiresAt - System.currentTimeMillis() + 10_000L)
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
            putExtra(CallIntent.EXTRA_CALL_ID, intent.getStringExtra(CallIntent.EXTRA_CALL_ID))
            putExtra(CallIntent.EXTRA_CALLER_NAME, callerName)
            putExtra(CallIntent.EXTRA_MEDIA_TYPE, callType)
        }
        startActivity(target)
        finish()
    }

    private fun buildContent(): View {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.BLACK)
            setPadding(dp(32), dp(48), dp(32), dp(56))
        }

        val label = TextView(this).apply {
            text = if (callType == "video") "Incoming video call" else "Incoming voice call"
            setTextColor(Color.parseColor("#BDBDBD"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
            gravity = Gravity.CENTER
        }

        val name = TextView(this).apply {
            text = callerName
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 32f)
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            setPadding(0, dp(16), 0, dp(48))
        }

        val actions = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
        }

        actions.addView(
            buildButton("Decline", filled = false) { handOff(CallIntent.ACTION_DECLINE) },
            LinearLayout.LayoutParams(0, dp(64), 1f).apply { marginEnd = dp(12) },
        )
        actions.addView(
            buildButton("Accept", filled = true) { handOff(CallIntent.ACTION_ACCEPT) },
            LinearLayout.LayoutParams(0, dp(64), 1f).apply { marginStart = dp(12) },
        )

        root.addView(label)
        root.addView(name)
        root.addView(actions)
        return root
    }

    private fun buildButton(label: String, filled: Boolean, onPress: () -> Unit): Button =
        Button(this).apply {
            text = label
            isAllCaps = false
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
            if (filled) {
                setBackgroundColor(Color.WHITE)
                setTextColor(Color.BLACK)
            } else {
                setBackgroundColor(Color.TRANSPARENT)
                setTextColor(Color.WHITE)
            }
            setOnClickListener { onPress() }
        }

    private fun dp(value: Int): Int =
        TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP,
            value.toFloat(),
            resources.displayMetrics,
        ).toInt()
}