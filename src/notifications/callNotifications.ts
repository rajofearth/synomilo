import notifee, {
  AndroidCategory,
  AndroidImportance,
  AndroidVisibility,
} from '@notifee/react-native';

export const MESSAGE_CHANNEL_ID = 'default';

/**
 * RING CHANNEL.
 *
 * v2 -> v3, and the bump is the whole point: `android.app.NotificationChannel` is
 * immutable once created. `createChannel` is not an upsert for the fields that
 * matter here - Android silently discards a second call's importance/sound/
 * vibration/visibility and keeps what the channel was born with. v2 was born with
 * `sound: 'content://settings/system/ringtone'`, so on every already-installed APK
 * that ringtone choice is frozen in the system database and no amount of editing
 * the JS could change it. v3 is a new id, so it is created fresh, once, with the
 * settings below actually in effect.
 *
 * Note that `AndroidImportance.MAX` does not exist in @notifee 9.x - the enum stops
 * at HIGH (4). Passing a raw 5 would be rejected by `validateAndroidChannel`
 * ("expected an Importance value") and abort channel creation.
 */
export const CALL_CHANNEL_ID = 'incoming_call_v3';

/**
 * The ongoing-call channel. Separate from the ringing channel on purpose: Android
 * makes a channel's importance and sound immutable once created, so a channel that
 * must be silent (ongoing) can never be the same channel as one that must ring.
 */
export const ONGOING_CHANNEL_ID = 'ongoing_call_v1';

/**
 * The ringtone, by NAME, not by system URI.
 *
 * Notifee resolves a sound string in this order (verified against the bundled AAR,
 * `n.o.t.i.f.e.e.r#c`): anything containing "://" is `Uri.parse`d verbatim,
 * "default" becomes `RingtoneManager.getDefaultUri(TYPE_NOTIFICATION)`, and
 * anything else is looked up as a `raw` resource and rewritten to
 * `android.resource://<package>/raw/<name>`.
 *
 * v2 used `content://settings/system/ringtone`, which takes the first branch and
 * points the ring at the user's *device* ringtone. That is silent on any phone
 * whose ringtone is set to None or to a "touch sounds only" profile - the channel
 * is configured correctly and produces no sound at all, which is exactly the
 * report. `ringtone.wav` (res/raw, 3s, 22.05kHz mono PCM) has been in the repo the
 * whole time and was referenced by no source file at all. Naming it here is the
 * only change needed to make the ringtone the app's own.
 *
 * Android still suppresses *any* notification sound while the ringer is off or DND
 * is active; nothing an app can do overrides that.
 */
export const RINGTONE = 'ringtone';

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
 * the caller name and callId without them.
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
    sound: RINGTONE,
    vibration: true,
    vibrationPattern: [400, 800, 400, 800],
    lights: true,
    lightColor: '#FFFFFF',
    visibility: AndroidVisibility.PUBLIC,
    badge: false,
    // Only honoured for apps the user has granted Do Not Disturb access to. It
    // costs nothing to declare and it is the difference between a ringing call and
    // a silent one for those users; for everyone else Android still applies the
    // ringer, which is correct.
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

export interface RingNotificationOptions {
  /**
   * The user is already inside the app, where `IncomingCallOverlay` is showing the
   * full-screen Accept/Decline card for this same call.
   *
   * It used to mean "do not post a notification at all", which is what made the
   * foreground path mute: no notification means no channel sound and no
   * vibration, so a call arriving while the app was open rang nowhere. The
   * foreground and background paths now converge on ONE ringing notification; the
   * only thing that changes is that its duplicate Accept/Decline buttons are
   * dropped, because the overlay already is the answer surface.
   */
  suppressActions?: boolean;
}

/**
 * The single ringing notification. Posted identically whether the app is
 * foreground, background or killed - the full-screen intent is attached in every
 * case because Android only fires one anyway when the keyguard is up.
 */
export async function showIncomingCallNotification(
  call: IncomingCallInfo,
  options?: RingNotificationOptions,
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
      ongoing: true,
      autoCancel: false,
      // A redelivered push (collapse-key replay, FCM retry) must not restart the
      // ring on a notification that is already ringing.
      onlyAlertOnce: true,
      timeoutAfter: RING_TIMEOUT_MS,
      visibility: AndroidVisibility.PUBLIC,
      smallIcon: 'ic_stat_call',
      tag: callNotificationId(call.callId),
      // Opens the RING SCREEN. It used to be `{ id: 'accept-call', launchActivity:
      // 'default' }`, which meant that whenever the full-screen intent did fire -
      // i.e. exactly on a locked screen - the thing it opened WAS the accept button.
      fullScreenAction: { id: 'open-call', launchActivity: RINGING_ACTIVITY },
      pressAction: { id: 'open-call', launchActivity: RINGING_ACTIVITY },
      actions: options?.suppressActions
        ? []
        : [
            { title: 'Decline', pressAction: { id: 'decline-call' } },
            { title: 'Accept', pressAction: { id: 'accept-call' } },
          ],
      showTimestamp: false,
    },
  });
}

export async function dismissCallNotification(callId: string): Promise<void> {
  try {
    await notifee.cancelNotification(callNotificationId(callId));
  } catch (error) {
    console.log('[push] dismiss call notification error', error);
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