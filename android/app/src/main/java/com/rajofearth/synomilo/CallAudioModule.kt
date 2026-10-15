package com.rajofearth.synomilo

import android.content.Context
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.media.RingtoneManager
import android.os.Build
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Audio routing for an in-progress call.
 *
 * `react-native-webrtc` exposes the media tracks but not the device the audio is
 * routed to, so without this the notification's "Speaker" action (and the in-call
 * button that would call it) cannot do anything. No extra dependency: this is the
 * platform AudioManager.
 */
class CallAudioModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "CallAudio"

    private fun audioManager(): AudioManager? =
        reactApplicationContext.getSystemService(Context.AUDIO_SERVICE) as? AudioManager

    /**
     * Puts the session into communication mode and picks the earpiece or the
     * loudspeaker. Returns false when the platform would not accept the change, so
     * the JS side can leave the UI in its previous state instead of lying.
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
            am.mode = AudioManager.MODE_IN_COMMUNICATION
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val wanted =
                    if (enabled) AudioDeviceInfo.TYPE_BUILTIN_SPEAKER
                    else AudioDeviceInfo.TYPE_BUILTIN_EARPIECE
                val device = am.availableCommunicationDevices.firstOrNull { it.type == wanted }
                if (device != null) {
                    am.setCommunicationDevice(device)
                    promise.resolve(true)
                    return
                }
            }
            am.isSpeakerphoneOn = enabled
            promise.resolve(true)
        } catch (error: Throwable) {
            promise.resolve(false)
        }
    }

    /** Hands audio back to the system when the call ends. */
    @ReactMethod
    fun releaseAudio(promise: Promise) {
        val am = audioManager()
        if (am == null) {
            promise.resolve(false)
            return
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                am.clearCommunicationDevice()
            }
            @Suppress("DEPRECATION")
            am.isSpeakerphoneOn = false
            am.mode = AudioManager.MODE_NORMAL
            promise.resolve(true)
        } catch (error: Throwable) {
            promise.resolve(false)
        }
    }

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
}