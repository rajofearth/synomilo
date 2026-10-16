package com.rajofearth.synomilo

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Audio for calls, and the in-app ring.
 *
 * Two responsibilities that used to be confused with each other:
 *
 *  1. ROUTING an in-progress call to the earpiece or the loudspeaker.
 *     `react-native-webrtc` exposes the media tracks but not the device the audio
 *     is routed to, so without this the notification's "Speaker" action cannot do
 *     anything. No extra dependency: this is the platform AudioManager.
 *
 *  2. RINGING while the app is visible. See [start]/[stop].
 *
 * ## Why there is a ring in here at all
 *
 * v1.1.3 made the ringing notification the single owner of the sound in every
 * state, and that is how "a call arrives while the app is open, the overlay
 * appears, and the ringtone and the vibration both stop while the call is still
 * ringing" happened: the overlay cancelled the notification and had nothing to
 * replace it with. So while the app is visible this module owns the ring, and the
 * notification owns it the moment the app is not visible (src/notifications/
 * foregroundRinging.ts is the JS half and the handover lives in
 * IncomingCallOverlay).
 *
 * The three properties that make this ring audible rather than merely present:
 *
 *   - `AudioAttributes.USAGE_NOTIFICATION` (the ringtone slot). A `MediaPlayer`
 *     with no attributes routes to
 *     STREAM_MUSIC, which follows the media volume, is ducked by anything else
 *     playing, and is the stream Android silences first. This is a phone
 *     ringing.
 *   - `AUDIOFOCUS_GAIN_TRANSIENT`, requested for the duration of the ring and
 *     abandoned when it stops. Transient rather than transient-exclusive: the
 *     call screen's own audio session must be able to take focus the instant the
 *     user accepts, and an exclusive request would make the two fight.
 *   - A hard timeout of [RING_TIMEOUT_MS], identical to the notification's
 *     `timeoutAfter` and to the server's ring window. JS can be suspended at any
 *     moment and cannot be relied on to stop this; the platform bound is what
 *     makes "the ring cannot outlast the call" true rather than aspirational.
 *
 * ## This module is not the only thing that touches audio
 *
 * `react-native-webrtc`'s native audio manager requests and abandons focus of its
 * own and puts the device into `MODE_IN_COMMUNICATION` when a track is created.
 * So [setSpeakerOn] no longer forces the audio mode, and [releaseAudio] no longer
 * unconditionally clears it: a leftover `MODE_IN_COMMUNICATION` silences the
 * ringer on a large share of devices, which presents as "the next incoming call
 * never sounds", and clearing it out from under a live peer connection drops the
 * other party off. Each side now undoes only its own change.
 */
class CallAudioModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "CallAudio"

    private fun audioManager(): AudioManager? =
        reactApplicationContext.getSystemService(Context.AUDIO_SERVICE) as? AudioManager

    private val mainHandler = Handler(Looper.getMainLooper())

    // ------------------------------------------------------------------ ring --

    private val ringLock = Any()
    private var ringPlayer: MediaPlayer? = null
    private var ringCallId: String? = null
    private var ringFocusRequest: AudioFocusRequest? = null
    private var ringHasFocus = false
    private var ringTimer: Runnable? = null

    private val focusListener = AudioManager.OnAudioFocusChangeListener { }

    /**
     * RING, FOREVER (until stopped or [RING_TIMEOUT_MS]).
     *
     * Idempotent per call: a second `start` for the call already ringing is a
     * no-op, so a re-render cannot restart the ringtone from its first bar, which
     * reads as a stutter. A `start` for a *different* call stops the previous one
     * first, so two incoming calls can never ring over each other.
     */
    @ReactMethod
    fun start(callId: String, promise: Promise) {
        val am = audioManager()
        if (am == null || callId.isEmpty()) {
            promise.resolve(false)
            return
        }
        val uri = runCatching { RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE) }
            .getOrNull()
        if (uri == null) {
            // No device ringtone. The foreground ring has no bundled fallback of
            // its own - `res/raw/ringtone.wav` is reachable only as a notification
            // channel sound - so this is reported honestly rather than as silence.
            promise.resolve(false)
            return
        }
        synchronized(ringLock) {
            if (ringCallId == callId && ringPlayer != null) {
                promise.resolve(true)
                return
            }
            if (ringCallId != null) {
                stopRingLocked(am)
            }
            startRingLocked(am, uri)
            ringCallId = callId
            promise.resolve(ringPlayer != null)
        }
    }

    /** Stop ringing. A no-op for a call this module is not ringing. */
    @ReactMethod
    fun stop(callId: String, promise: Promise) {
        val am = audioManager()
        synchronized(ringLock) {
            if (ringCallId == null || ringCallId != callId) {
                promise.resolve(false)
                return
            }
            if (am != null) {
                stopRingLocked(am)
            } else {
                abandonFocusLocked(null)
            }
            ringCallId = null
        }
        promise.resolve(true)
    }

    /** True while this module owns the foreground ring. */
    @ReactMethod
    fun isRinging(promise: Promise) {
        promise.resolve(synchronized(ringLock) { ringCallId != null })
    }

    private fun startRingLocked(am: AudioManager, uri: Uri) {
        requestRingFocusLocked(am)
        val player = MediaPlayer()
        ringPlayer = player
        runCatching {
            player.setAudioAttributes(RING_ATTRIBUTES)
            player.setDataSource(reactApplicationContext, uri)
            player.isLooping = true
            player.setOnPreparedListener { prepared ->
                // Guarded: `stop` can land between `prepareAsync` and this callback.
                if (ringPlayer === prepared) {
                    runCatching { prepared.start() }
                }
            }
            player.setOnErrorListener { _, _, _ ->
                synchronized(ringLock) {
                    if (ringPlayer === player) {
                        stopRingLocked(am)
                        ringCallId = null
                    }
                }
                true
            }
            player.prepareAsync()
        }.onFailure {
            if (ringPlayer === player) {
                abandonFocusLocked(am)
            }
            ringPlayer = null
            runCatching { player.release() }
        }
        startVibration()
        armRingTimeout()
    }

    private fun stopRingLocked(am: AudioManager) {
        ringTimer?.let { mainHandler.removeCallbacks(it) }
        ringTimer = null
        ringPlayer?.let { player ->
            runCatching {
                if (player.isPlaying) player.stop()
            }
            runCatching { player.reset() }
            runCatching { player.release() }
        }
        ringPlayer = null
        cancelVibration()
        abandonFocusLocked(am)
    }

    /**
     * The hard bound. Without it a ring whose JS owner was suspended - the user
     * swiped away mid-ring and never came back - would keep sounding until the
     * process died, which is the one failure mode a phone call must not have.
     */
    private fun armRingTimeout() {
        ringTimer?.let { mainHandler.removeCallbacks(it) }
        val timer = Runnable {
            synchronized(ringLock) {
                audioManager()?.let { stopRingLocked(it) } ?: abandonFocusLocked(null)
                ringCallId = null
            }
        }
        ringTimer = timer
        mainHandler.postDelayed(timer, RING_TIMEOUT_MS)
    }

    private fun requestRingFocusLocked(am: AudioManager) {
        if (ringHasFocus) {
            return
        }
        val granted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val request =
                AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                    .setAudioAttributes(RING_ATTRIBUTES)
                    .setOnAudioFocusChangeListener(focusListener)
                    .build()
            ringFocusRequest = request
            am.requestAudioFocus(request) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
        } else {
            @Suppress("DEPRECATION")
            am.requestAudioFocus(
                focusListener,
                AudioManager.STREAM_RING,
                AudioManager.AUDIOFOCUS_GAIN_TRANSIENT,
            ) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
        }
        ringHasFocus = granted
    }

    private fun abandonFocusLocked(am: AudioManager?) {
        if (!ringHasFocus) {
            return
        }
        ringHasFocus = false
        val manager = am ?: audioManager() ?: return
        runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ringFocusRequest?.let { manager.abandonAudioFocusRequest(it) }
            } else {
                @Suppress("DEPRECATION")
                manager.abandonAudioFocus(focusListener)
            }
        }
        ringFocusRequest = null
    }

    private fun vibrator(): Vibrator? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val manager = reactApplicationContext
                .getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager
            manager?.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            reactApplicationContext.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
        }

    /** The same cadence the ring channel vibrates with, so the two owners agree. */
    @Suppress("DEPRECATION")
    private fun startVibration() {
        val vibrator = vibrator() ?: return
        if (!vibrator.hasVibrator()) {
            return
        }
        runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val effect = VibrationEffect.createWaveform(RING_VIBRATION_PATTERN, 0)
                vibrator.vibrate(effect, RING_ATTRIBUTES)
            } else {
                vibrator.vibrate(RING_VIBRATION_PATTERN, 0)
            }
        }
    }

    private fun cancelVibration() {
        runCatching { vibrator()?.cancel() }
    }

    // ------------------------------------------------------------- ringtone --

    /**
     * The device's own default ringtone, as a URI string - or null when the user
     * has set their ringtone to None.
     *
     * Exists because `android.app.NotificationChannel.setSound` freezes whatever
     * URI it is handed, so the channel has to be BORN with the right one: there is
     * no way to discover "None" later and retune a channel that already exists.
     * Notifee cannot answer this question itself - its own resolution order
     * (verified against the bundled core AAR, `n.o.t.i.f.e.e.r#c`) is "contains
     * `://`" -> `Uri.parse` verbatim, then the literal `default` ->
     * `RingtoneManager.getDefaultUri(TYPE_NOTIFICATION)`, which is the
     * *notification* sound, not the ringtone. No string reaches TYPE_RINGTONE.
     *
     * So JS asks here, and falls back to a bundled clip when this returns null.
     */
    @ReactMethod
    fun getDefaultRingtoneUri(promise: Promise) {
        try {
            promise.resolve(
                RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)?.toString()
            )
        } catch (error: Throwable) {
            promise.resolve(null)
        }
    }

    /**
     * Whether `uri` can actually be played by this app, right now.
     *
     * The counterpart to [getDefaultRingtoneUri], and the reason a ring channel
     * stops being born silent. `getDefaultUri` answers "what has the user
     * selected", which is not the same question as "can this app open it": a
     * cloud- or carrier-ringtone `content://` resolves fine and then fails to
     * produce audio, and that URI would be frozen into an immutable notification
     * channel and produce a permanently silent ring that no later JS can repair.
     *
     * So the URI is opened with the platform media stack and asked for its
     * duration. `prepare()` is the only honest test - the alternative, trusting
     * the URI, is the bug.
     */
    @ReactMethod
    fun isRingtonePlayable(uri: String, promise: Promise) {
        if (uri.isBlank()) {
            promise.resolve(false)
            return
        }
        val player = MediaPlayer()
        try {
            player.setAudioAttributes(RING_ATTRIBUTES)
            player.setDataSource(reactApplicationContext, Uri.parse(uri))
            player.prepare()
            val duration = player.duration
            promise.resolve(duration > 0L)
        } catch (error: Throwable) {
            promise.resolve(false)
        } finally {
            runCatching { player.release() }
        }
    }

    // -------------------------------------------------------------- routing --

    /** Set when THIS module is the one that changed the audio mode. */
    private var ownsAudioMode = false

    /**
     * Set when THIS module left a routing override behind - a communication
     * device, or the speakerphone flag.
     *
     * Deliberately separate from [ownsAudioMode]. `react-native-webrtc` sets
     * `MODE_IN_COMMUNICATION` itself when a track is created and is entitled to
     * own it, so on the ordinary path this module did NOT change the mode - and
     * a single flag therefore reported "not mine" and left the communication-device
     * override in place. That override outlived the call: the earpiece or the
     * speaker kept winning over whatever the user plugged in for the next one,
     * which presents as "the headset stopped working".
     *
     * "Acquired, not inferred" in both directions: each owner releases only what
     * it actually took.
     */
    private var ownsRoute = false

    /**
     * Picks the earpiece or the loudspeaker. Returns false when the platform would
     * not accept the change, so the JS side can leave the UI in its previous state
     * instead of lying.
     *
     * The audio MODE is left alone unless it is already in communication mode, or
     * is already this module's to undo. `react-native-webrtc` sets
     * `MODE_IN_COMMUNICATION` itself when a track is created and is entitled to
     * own it; forcing it here fought that owner, and a mode left stuck in
     * communication state is what silences the ringer on many devices - which
     * surfaced as the *next* incoming call never being heard.
     */
    @ReactMethod
    @Suppress("DEPRECATION")
    fun setSpeakerOn(enabled: Boolean, promise: Promise) {
        val am = audioManager()
        if (am == null) {
            promise.resolve(false)
            return
        }
        try {
            if (am.mode != AudioManager.MODE_IN_COMMUNICATION) {
                am.mode = AudioManager.MODE_IN_COMMUNICATION
                ownsAudioMode = true
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val wanted =
                    if (enabled) AudioDeviceInfo.TYPE_BUILTIN_SPEAKER
                    else AudioDeviceInfo.TYPE_BUILTIN_EARPIECE
                val device = am.availableCommunicationDevices.firstOrNull { it.type == wanted }
                if (device != null) {
                    am.setCommunicationDevice(device)
                    ownsRoute = true
                    promise.resolve(true)
                    return
                }
            }
            am.isSpeakerphoneOn = enabled
            ownsRoute = true
            promise.resolve(true)
        } catch (error: Throwable) {
            promise.resolve(false)
        }
    }

    /**
     * Voice-call mode with NO preference about where the audio comes out.
     *
     * What call setup used to do was `setSpeakerOn(false)`, which on API 31+ is
     * `setCommunicationDevice(TYPE_BUILTIN_EARPIECE)` and below it an explicit
     * `isSpeakerphoneOn = false`. Both are *overrides*. An override applied at
     * setup, before the user has expressed any preference, is what forced the
     * earpiece for the whole call - so a Bluetooth headset or a car kit was
     * ignored from the moment the call connected, and the only way to get it back
     * was to notice and press "Earpiece" to turn the override off again.
     *
     * `MODE_IN_COMMUNICATION` on its own already does the right thing: the
     * platform prefers a connected Bluetooth or wired device and falls back to
     * the earpiece. So this sets the mode, prefers an external device if one is
     * there, and otherwise *clears* any override rather than installing one -
     * `clearCommunicationDevice()` is the platform's own "route it yourself" and
     * is also how a stale override from a previous call gets undone.
     */
    @ReactMethod
    @Suppress("DEPRECATION")
    fun useDefaultRoute(promise: Promise) {
        val am = audioManager()
        if (am == null) {
            promise.resolve(false)
            return
        }
        try {
            if (am.mode != AudioManager.MODE_IN_COMMUNICATION) {
                am.mode = AudioManager.MODE_IN_COMMUNICATION
                ownsAudioMode = true
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val preferred = preferredCommunicationDevice(am)
                if (preferred != null) {
                    am.setCommunicationDevice(preferred)
                    ownsRoute = true
                } else {
                    // Nothing external. Saying nothing is the earpiece: the
                    // platform's own preference order, and not an override that
                    // has to be undone later.
                    am.clearCommunicationDevice()
                    ownsRoute = false
                }
            } else {
                // Below API 31 there is no communication-device API. Legacy
                // routing with the speakerphone off already prefers a plugged-in
                // headset over the earpiece, so this is the whole fix on those
                // versions.
                am.isSpeakerphoneOn = false
                ownsRoute = true
            }
            promise.resolve(true)
        } catch (error: Throwable) {
            promise.resolve(false)
        }
    }

    /**
     * The Bluetooth or wired device this call should use, or null to let the
     * platform decide.
     *
     * Ordered rather than "first available", because `availableCommunicationDevices`
     * has no order of preference and a headset advertising several profiles is
     * only useful for a call over the HFP/SCO one - picking its A2DP entry routes
     * call audio somewhere the peer cannot be heard.
     *
     * Verified against this platform's `AudioDeviceInfo` constants
     * (`javap -constants android-36/android.jar`): TYPE_BLUETOOTH_SCO = 7,
     * TYPE_WIRED_HEADSET = 3, TYPE_WIRED_HEADPHONES = 4, TYPE_USB_HEADSET = 22,
     * TYPE_USB_DEVICE = 11. Note there is no `getActiveCommunicationDevice()` on
     * `AudioManager` at any of these API levels, so "already active" is decided
     * from the available list.
     */
    private fun preferredCommunicationDevice(am: AudioManager): AudioDeviceInfo? {
        val devices =
            runCatching { am.availableCommunicationDevices }.getOrNull() ?: return null
        val preferredTypes =
            intArrayOf(
                AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
                AudioDeviceInfo.TYPE_WIRED_HEADSET,
                AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
                AudioDeviceInfo.TYPE_USB_HEADSET,
                AudioDeviceInfo.TYPE_USB_DEVICE,
            )
        for (type in preferredTypes) {
            devices.firstOrNull { it.type == type }?.let { return it }
        }
        return null
    }

    /**
     * Hands audio back to the system when the call ends.
     *
     * Only undoes what this module actually took, and the mode and the route are
     * tracked separately - see [ownsRoute]. This runs from the call screen's
     * unmount cleanup AND from `hideOngoingCallNotification`, so an unconditional
     * `MODE_NORMAL` here was a second audio owner: leaving a call, or hiding the
     * ongoing notification on the way back to the foreground, dropped a live peer
     * connection's audio out of communication mode.
     */
    @ReactMethod
    @Suppress("DEPRECATION")
    fun releaseAudio(promise: Promise) {
        val am = audioManager()
        if (am == null) {
            promise.resolve(false)
            return
        }
        if (!ownsAudioMode && !ownsRoute) {
            promise.resolve(false)
            return
        }
        val releaseMode = ownsAudioMode
        val releaseRoute = ownsRoute
        ownsAudioMode = false
        ownsRoute = false
        try {
            if (releaseRoute) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    am.clearCommunicationDevice()
                }
                am.isSpeakerphoneOn = false
            }
            if (releaseMode) {
                am.mode = AudioManager.MODE_NORMAL
            }
            promise.resolve(true)
        } catch (error: Throwable) {
            promise.resolve(false)
        }
    }

    override fun invalidate() {
        // The bridge is going away. A ring must never outlive the thing that owns
        // it, and a terminal push that arrives during teardown has no JS left to
        // stop it.
        runCatching {
            val am = audioManager()
            synchronized(ringLock) {
                if (am != null) {
                    stopRingLocked(am)
                } else {
                    abandonFocusLocked(null)
                }
                ringCallId = null
            }
        }
        super.invalidate()
    }

    private companion object {
        /**
         * Mirrors the server's ring window (convex/calls.ts RING_TIMEOUT_MS) and the
         * ringing notification's `timeoutAfter`, so every owner of this ring stops
         * at the same instant.
         */
        const val RING_TIMEOUT_MS = 60_000L

        /** Same cadence as the ring channel's `vibrationPattern`. */
        val RING_VIBRATION_PATTERN = longArrayOf(0, 400, 800, 400, 800)

        /**
         * Usage 5 - `USAGE_NOTIFICATION`, the *notification* slot.
         *
         * The value is deliberately left alone for now; what is corrected here is
         * the claim this comment used to make. It asserted that
         * `USAGE_NOTIFICATION_RINGTONE` "does not exist on this platform, which is
         * exactly the kind of thing that turns into 'it compiles on my machine'".
         * That is false, and it was checked against the jar this APK compiles
         * against:
         *
         *     javap -constants -cp "$ANDROID_HOME/platforms/android-36/android.jar" \
         *       android.media.AudioAttributes
         *     ... USAGE_NOTIFICATION = 5;
         *     ... USAGE_NOTIFICATION_RINGTONE = 6;
         *
         * So the real trade is not "exists / does not exist", it is which usage a
         * ring should carry, and that is a product decision rather than a
         * compile-time one:
         *
         *  - `USAGE_NOTIFICATION` routes to the notification stream, so the ring
         *    follows *notification* volume and is subject to the notification DND
         *    filter (a "priority only" Do Not Distinguish silences it).
         *  - `USAGE_NOTIFICATION_RINGTONE` is documented as "the usage is
         *    telephony ringtone" and follows the ringer stream, which is what
         *    Android's own calling-app guidance uses for an incoming-call channel.
         *
         * Changing it is a one-line edit here, but it changes what the user hears
         * and needs a device to confirm, so it is not being made blind. Note also
         * that the native ring and the notification channel would have to agree -
         * the channel's attributes are frozen at creation, so both ring owners
         * need the same answer or they disagree with each other.
         *
         * What *is* already deliberate here and must not be changed: the content
         * type is `CONTENT_TYPE_SONIFICATION`, which is what stops a
         * no-attribute `MediaPlayer` from landing on STREAM_MUSIC and being
         * ducked by anything else playing.
         */
        val RING_ATTRIBUTES: AudioAttributes = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()
    }
}
