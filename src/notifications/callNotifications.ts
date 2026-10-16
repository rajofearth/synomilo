import { NativeModules, Platform } from 'react-native';
import notifee, {
  AndroidCategory,
  AndroidImportance,
  AndroidVisibility,
} from '@notifee/react-native';

export const MESSAGE_CHANNEL_ID = 'default';

/**
 * RING CHANNEL.
 *
 * v2 -> v3 -> v4 -> v5, and every bump is forced by one fact:
 * `android.app.NotificationChannel` is immutable once created. `createChannel` is
 * not an upsert for the fields that matter here - Android silently discards a
 * second call's importance/sound/vibration/visibility and keeps what the channel
 * was born with. A fresh id is the only way to actually change any of it on an
 * already-installed APK, so editing the JS in place proves nothing on a device
 * that already has the old channel.
 *
 *  v2: `content://settings/system/ringtone`. Correct intent, but it is the whole
 *      story only when the user has a ringtone: `content://` URIs are handed
 *      straight to the media stack, so "ringtone = None" or a touch-sounds-only
 *      profile means the channel is configured correctly and produces no sound.
 *  v3: the bundled `res/raw/ringtone.wav`. Louder and never silent, but that file
 *      was a 440 Hz + 480 Hz dual tone - the SAME two frequencies, at the SAME
 *      amplitude, as `src/assets/sounds/ringback.wav`, the OUTGOING dial tone.
 *      Measured, not assumed: a Goertzel sweep of both files puts both peaks at
 *      74 dB on 440 and 480. So swapping one wrong URI for one wrong asset traded
 *      "no ringtone" for "the incoming call sounds exactly like the dialling tone",
 *      which is how it was reported as reversed.
 *  v4: the device ringtone again, but only after the fallback has been made
 *      honest - see [BUNDLED_RINGTONE] and [resolveRingSound].
 *  v5: the same, with the device ringtone CHECKED before it is frozen into the
 *      channel. v4 accepted any non-empty string, so a ringtone URI that does
 *      not resolve - a provider-backed `content://` this app cannot read, a
 *      default that has been revoked - was written into an immutable channel and
 *      produced a permanently silent ring. See [resolveRingSound].
 *
 * Note that `AndroidImportance.MAX` does not exist in @notifee 9.x - the enum stops
 * at HIGH (4). Passing a raw 5 would be rejected by `validateAndroidChannel`
 * ("expected an Importance value") and abort channel creation.
 */
export const CALL_CHANNEL_ID = 'incoming_call_v5';

/**
 * The ongoing-call channel. Separate from the ringing channel on purpose: Android
 * makes a channel's importance and sound immutable once created, so a channel that
 * must be silent (ongoing) can never be the same channel as one that must ring.
 */
export const ONGOING_CHANNEL_ID = 'ongoing_call_v1';

/**
 * `Settings.System.DEFAULT_RINGTONE_URI`, written out.
 *
 * The primary ring for `incoming_call_v4`, and the correct answer to "the ringtone
 * isn't the default of the user's device". A user's ringtone is the one sound they
 * have already told the phone is how a phone should ring, and - unlike anything
 * this app ships - it is provably not the app's dial tone.
 *
 * Notifee's resolution order (verified against the bundled core AAR,
 * `n.o.t.i.f.e.e.r#c`): anything containing "://" is `Uri.parse`d verbatim,
 * "default" becomes `RingtoneManager.getDefaultUri(TYPE_NOTIFICATION)` - the
 * notification sound, NOT the ringtone - and anything else is looked up as a `raw`
 * resource. Note what is absent: there is no string that yields
 * `TYPE_RINGTONE`. That is why [resolveRingSound] asks the platform directly
 * rather than hoping for a magic literal.
 */
export const SYSTEM_RINGTONE_URI = 'content://settings/system/ringtone';

/**
 * The bundled fallback, by NAME, which Notifee rewrites to
 * `android.resource://<package>/raw/ringtone`.
 *
 * Only reached when `RingtoneManager.getDefaultUri(TYPE_RINGTONE)` is null, i.e.
 * the user has set their ringtone to None. That case used to be answered with
 * silence (v2), which is worse than either alternative: a call that cannot be
 * heard is a failed call.
 *
 * The file has been REPLACED. It used to be the same 440+480 Hz dual tone as the
 * outgoing ringback, so the fallback re-created the original bug in precisely the
 * situation where the user had already said they do not want noise. It is now
 * 1050 Hz + 1400 Hz (a 2:3 pair, 64 dB each) under a 25 Hz tremolo, in a
 * two-burst cadence - 0.40 s on, 0.20 s off, 0.40 s on, 3.00 s off, 4.00 s total.
 * At 1400 Hz the dial tone sits 100 dB below this file's peak, so the two can no
 * longer be confused by anyone, including by accident.
 */
export const BUNDLED_RINGTONE = 'ringtone';

/**
 * The lock-screen ring UI. `launchActivity: 'default'` resolved to the app's single
 * launcher activity, and MainActivity has no showWhenLocked/turnScreenOn, so the
 * full-screen intent used to open a keyguard-obscured blank screen.
 *
 * Notifee treats a value containing a "." as a class name (verified in
 * IntentUtils#getClass in the bundled AAR), so the fully-qualified name is used here.
 *
 * Notifee attaches the notification payload to this intent ONLY when the press
 * action carries a `mainComponent`. It does not, so `IncomingCallActivity` is
 * launched with no extras whatsoever - see IncomingCallActivity for how it recovers
 * the caller name and callId without them, and for why it is also what cancels the
 * notification once the ring screen goes away.
 */
export const RINGING_ACTIVITY = 'com.rajofearth.synomilo.IncomingCallActivity';


/**
 * The server's ring window (convex/calls.ts RING_TIMEOUT_MS). Mirrored here because
 * `timeoutAfter` has to be computed client-side when the notification is displayed
 * and the payload does not carry an expiry.
 */
export const RING_TIMEOUT_MS = 60000;

/** Prefix of every ringing notification id. Mirrored in IncomingCallActivity.kt. */
export const CALL_NOTIFICATION_PREFIX = 'call:';

export const callNotificationId = (callId: string) => `${CALL_NOTIFICATION_PREFIX}${callId}`;
export const ongoingNotificationId = (callId: string) => `ongoing:${callId}`;

let channelsReady = false;

/**
 * Which sound the ring channel is born with.
 *
 * Must be decided ONCE, at creation time, because the channel freezes it. Notifee
 * cannot answer this for us: its resolution order (verified in the bundled core
 * AAR, `n.o.t.i.f.e.e.r#c`) has no path to `RingtoneManager.TYPE_RINGTONE` at all -
 * `content://settings/system/ringtone` goes through `Uri.parse` and is handed to the
 * media stack regardless of whether it resolves to anything, and the literal
 * `default` yields TYPE_NOTIFICATION. So a null from the platform means "the user
 * has set their ringtone to None", and the honest answer to that is a bundled
 * ringtone rather than a channel that is configured correctly and silent.
 *
 * ## Why v4 was not enough
 *
 * "Non-empty" is not "playable". `RingtoneManager.getDefaultUri(TYPE_RINGTONE)`
 * returns whatever Settings has selected, which on a real device is very often a
 * URI this app cannot open at all: a carrier- or cloud-ringtone provider backed by
 * an account the app has no access to, or a default that has since been revoked.
 * v4 checked only for emptiness, wrote that URI into an immutable channel, and the
 * result was a channel configured perfectly and permanently silent - the "sometimes
 * there is no ringtone at all" report, and unfixable from JS afterwards, because
 * Android will not let a channel's sound be changed in place.
 *
 * So the URI is now ASKED whether it can actually be played
 * (`CallAudio.isRingtonePlayable`, which opens it with the platform media stack)
 * and the bundled clip is used when it cannot be. Both failure modes now land on a
 * ring the user can hear.
 */
async function resolveRingSound(): Promise<string> {
  if (Platform.OS !== 'android') {
    return SYSTEM_RINGTONE_URI;
  }
  try {
    const audio = NativeModules.CallAudio as
      | {
          getDefaultRingtoneUri?: () => Promise<string | null>;
          isRingtonePlayable?: (uri: string) => Promise<boolean>;
        }
      | undefined;
    const uri = (await audio?.getDefaultRingtoneUri?.())?.trim();
    if (!uri) {
      return BUNDLED_RINGTONE;
    }
    // A platform with no validator cannot be asked. Taking the URI at its word is
    // the old behaviour and is no worse; on Android the module is always present.
    if (audio?.isRingtonePlayable && !(await audio.isRingtonePlayable(uri))) {
      console.log('[push] device ringtone will not play, using bundled ringtone');
      return BUNDLED_RINGTONE;
    }
    return uri;
  } catch (error) {
    console.log('[push] ringtone lookup failed, using bundled ringtone', error);
    return BUNDLED_RINGTONE;
  }
}

async function createChannelSafely(channel: {
  id: string;
  name: string;
  [key: string]: unknown;
}): Promise<void> {
  try {
    await notifee.createChannel(channel as never);
  } catch (error) {
    // One bad channel must not abort the rest: a throw out of the middle of the
    // sequence used to leave the ongoing-call channel uncreated while logging only
    // "[push] channel setup error" against whichever channel threw.
    console.log('[push] channel setup failed', channel.id, error);
  }
}

export async function ensureNotificationChannels(): Promise<void> {
  if (channelsReady) {
    return;
  }
  await createChannelSafely({
    id: MESSAGE_CHANNEL_ID,
    name: 'Messages',
    importance: AndroidImportance.HIGH,
    vibration: true,
  });
  await createChannelSafely({
    id: CALL_CHANNEL_ID,
    name: 'Incoming calls',
    importance: AndroidImportance.HIGH,
    sound: await resolveRingSound(),
    vibration: true,
    vibrationPattern: [400, 800, 400, 800],
    lights: true,
    lightColor: '#FFFFFF',
    visibility: AndroidVisibility.PUBLIC,
    badge: false,
    // Only honoured for apps the user has granted Do Not Disturb access to. It
    // costs nothing to declare and it is the difference between a ringing call and
    // a silent one for those users; for everyone else Android still applies the
    // ringer, which is correct. It never makes anything last longer -
    // `timeoutAfter` below bounds the ring regardless of whether it is audible.
    bypassDnd: true,
  });
  await createChannelSafely({
    id: ONGOING_CHANNEL_ID,
    name: 'Ongoing calls',
    description: 'Shows the call you are currently in',
    // LOW + no sound: an ongoing call notification must never make a sound.
    // Re-alerting on a channel change is what makes a call "ring" mid-conversation.
    importance: AndroidImportance.LOW,
    vibration: false,
    lights: false,
    visibility: AndroidVisibility.PUBLIC,
    badge: false,
  });
  channelsReady = true;
}

export interface IncomingCallInfo {
  callId: string;
  callerName: string;
  type: 'audio' | 'video';
}

/**
 * The single ringing notification.
 *
 * Posted when the app is NOT visible - backgrounded, killed, or in the window
 * where the overlay has handed the ring over on its way out. While the app is
 * visible the overlay owns the ring instead and no notification exists at all:
 * `handleDataMessage` returns before reaching this, and the overlay cancels any
 * ringing notification that was already posted by a push that arrived first.
 */
export async function showIncomingCallNotification(
  call: IncomingCallInfo,
): Promise<void> {
  await ensureNotificationChannels();
  // A blank name must never reach the ring screen or the shade as the literal
  // word "unknown"; fall back to the state, and let the name win whenever the
  // push actually carried one.
  const callerName = call.callerName?.trim() ?? '';
  const displayName = callerName || 'Incoming call';
  const body =
    call.type === 'video' ? 'Incoming video call' : 'Incoming voice call';

  await notifee.displayNotification({
    id: callNotificationId(call.callId),
    title: displayName,
    body,
    data: {
      type: 'call',
      callId: call.callId,
      callType: call.type,
      callerName: displayName,
      ringExpiresAt: String(Date.now() + RING_TIMEOUT_MS),
    },
    android: {
      channelId: CALL_CHANNEL_ID,
      category: AndroidCategory.CALL,
      importance: AndroidImportance.HIGH,
      loopSound: true,
      // NOT ongoing. `ongoing: true` means Android will not let the user swipe it
      // away and the system treats it as persistent, which turns any missed
      // teardown into a notification the user cannot get rid of at all. Every exit
      // path cancels this explicitly, and if one ever regresses the user can still
      // dismiss it by hand instead of being stuck with an alerting shade entry.
      ongoing: false,
      // ...but a body press must NOT auto-cancel it: `IncomingCallActivity` reads
      // its payload out of the posted notification (see its KDoc), so cancelling on
      // press made the ring screen refuse to draw.
      autoCancel: false,
      // A redelivered push (collapse-key replay, FCM retry) must not restart the
      // ring on a notification that is already ringing.
      onlyAlertOnce: true,
      // The hard bound. Even if every teardown path below fails - app killed, JS
      // never boots, no terminal push delivered - the ring cannot outlast the
      // server's own ring window. This is what makes "degrade sanely when the
      // device is silent or on Do Not Disturb" true rather than aspirational.
      timeoutAfter: RING_TIMEOUT_MS,
      visibility: AndroidVisibility.PUBLIC,
      smallIcon: 'ic_stat_call',
      tag: callNotificationId(call.callId),
      // Opens the RING SCREEN. It used to be `{ id: 'accept-call', launchActivity:
      // 'default' }`, which meant that whenever the full-screen intent did fire -
      // i.e. exactly on a locked screen - the thing it opened WAS the accept button.
      fullScreenAction: { id: 'open-call', launchActivity: RINGING_ACTIVITY },
      pressAction: { id: 'open-call', launchActivity: RINGING_ACTIVITY },
      // Always present. This notification is only ever posted when the app is not
      // visible, so there is never an overlay behind it to duplicate these.
      actions: [
        { title: 'Decline', pressAction: { id: 'decline-call' } },
        { title: 'Accept', pressAction: { id: 'accept-call' } },
      ],
      showTimestamp: false,
    },
  });
}

/**
 * Take down every notification that belongs to one call.
 *
 * Both ids, always. `call:<id>` is the ring; `ongoing:<id>` is the connected-call
 * notification with no `timeoutAfter` of its own, so a leak there is permanent
 * rather than merely annoying. Cancelling both together is what makes "one call,
 * one notification lifetime" true instead of aspirational, and it costs nothing
 * on the accept path, where `ongoing:` does not exist yet.
 *
 * Deliberately does NOT go through `hideOngoingCallNotification`: that also stops
 * the foreground service and releases the audio route, and neither belongs in a
 * teardown that may be running while a call is being set up.
 */
export async function cancelAllCallNotifications(callId: string): Promise<void> {
  await Promise.all([
    dismissCallNotification(callId),
    dismissOngoingNotification(callId),
  ]);
}

export async function dismissCallNotification(callId: string): Promise<void> {
  try {
    await notifee.cancelNotification(callNotificationId(callId));
  } catch (error) {
    console.log('[push] dismiss call notification error', error);
  }
}

/** Local mirror of `hideOngoingCallNotification`, without the side effects. */
export async function dismissOngoingNotification(callId: string): Promise<void> {
  try {
    await notifee.cancelNotification(ongoingNotificationId(callId));
  } catch (error) {
    console.log('[push] dismiss ongoing notification error', error);
  }
}

/**
 * Drop ringing notifications the server no longer knows about.
 *
 * This is also the "there is nothing ringing, take the notification down" call:
 * `reconcileCallNotifications([])` cancels every `call:*` notification and leaves
 * `ongoing:*` alone, so it can never tear down the notification for a call that is
 * already connected.
 *
 * The terminal push (`cancelled`/`ended`) is the fast path, but it is best-effort:
 * a phone that was offline, or that FCM could not deliver to inside the TTL, only
 * finds out on its next resume. Called on every resume with the ids the server
 * still considers live, so nothing stale can be answered.
 */
export async function reconcileCallNotifications(
  liveCallIds: string[],
): Promise<string[]> {
  try {
    const keep = new Set(liveCallIds.map(callNotificationId));
    const displayed = await notifee.getDisplayedNotifications();
    const stale = displayed
      .map(entry => entry.id ?? '')
      .filter(
        id => id.startsWith(CALL_NOTIFICATION_PREFIX) && !keep.has(id),
      );
    await Promise.all(
      stale.map(id => notifee.cancelNotification(id).catch(() => undefined)),
    );
    return stale.map(id => id.slice(CALL_NOTIFICATION_PREFIX.length));
  } catch (error) {
    console.log('[push] reconcile call notifications error', error);
    return [];
  }
}