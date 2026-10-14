import notifee, {
  AndroidCategory,
  AndroidImportance,
  AndroidVisibility,
} from '@notifee/react-native';

export const MESSAGE_CHANNEL_ID = 'default';
export const CALL_CHANNEL_ID = 'incoming_call_v2';
/**
 * The ongoing-call channel. Separate from the ringing channel on purpose: Android
 * makes a channel's importance and sound immutable once created, so a channel that
 * must be silent (ongoing) can never be the same channel as one that must ring.
 */
export const ONGOING_CHANNEL_ID = 'ongoing_call_v1';

const SYSTEM_RINGTONE_URI = 'content://settings/system/ringtone';

/**
 * The lock-screen ring UI. `launchActivity: 'default'` resolved to the app's single
 * launcher activity, and MainActivity has no showWhenLocked/turnScreenOn, so the
 * full-screen intent used to open a keyguard-obscured blank screen.
 *
 * Notifee treats a value containing a "." as a class name (verified in
 * IntentUtils#getClass in the bundled AAR), so the fully-qualified name is used here.
 */
export const RINGING_ACTIVITY = 'com.rajofearth.synomilo.IncomingCallActivity';

/**
 * The server's ring window (convex/calls.ts RING_TIMEOUT_MS). Mirrored here because
 * `timeoutAfter` has to be computed client-side when the notification is displayed
 * and the payload does not carry an expiry.
 */
export const RING_TIMEOUT_MS = 60000;

export const callNotificationId = (callId: string) => `call:${callId}`;
export const ongoingNotificationId = (callId: string) => `ongoing:${callId}`;

let channelsReady = false;

export async function ensureNotificationChannels(): Promise<void> {
  if (channelsReady) {
    return;
  }
  try {
    await notifee.createChannel({
      id: MESSAGE_CHANNEL_ID,
      name: 'Messages',
      importance: AndroidImportance.HIGH,
      vibration: true,
    });
    await notifee.createChannel({
      id: CALL_CHANNEL_ID,
      name: 'Incoming calls',
      importance: AndroidImportance.HIGH,
      sound: SYSTEM_RINGTONE_URI,
      vibration: true,
      vibrationPattern: [400, 800, 400, 800],
      lights: true,
      lightColor: '#FFFFFF',
      visibility: AndroidVisibility.PUBLIC,
      badge: false,
    });
    await notifee.createChannel({
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
  } catch (error) {
    console.log('[push] channel setup error', error);
  }
}

export interface IncomingCallInfo {
  callId: string;
  callerName: string;
  type: 'audio' | 'video';
}

export async function showIncomingCallNotification(
  call: IncomingCallInfo,
): Promise<void> {
  await ensureNotificationChannels();
  await notifee.displayNotification({
    id: callNotificationId(call.callId),
    title: call.callerName,
    body:
      call.type === 'video' ? 'Incoming video call' : 'Incoming voice call',
    data: {
      type: 'call',
      callId: call.callId,
      callType: call.type,
      callerName: call.callerName,
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
      actions: [
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

export async function dismissAllCallNotifications(): Promise<void> {
  try {
    const displayed = await notifee.getDisplayedNotifications();
    await Promise.all(
      displayed
        .filter(
          entry =>
            (entry.id ?? '').startsWith('call:') ||
            (entry.id ?? '').startsWith('ongoing:'),
        )
        .map(entry => notifee.cancelNotification(entry.id as string)),
    );
  } catch (error) {
    console.log('[push] dismiss all call notifications error', error);
  }
}

/**
 * Drop ringing notifications the server no longer knows about.
 *
 * There is no terminal push today (convex/calls.ts `end`/`markTimedOut` schedule
 * none), so a phone that was offline for a call keeps a `call:*` notification until
 * its own 60s timeout expires; answering it then fails with "This call is no longer
 * ringing". Called on every resume with the ids the server still considers live.
 */
export async function reconcileCallNotifications(
  liveCallIds: string[],
): Promise<string[]> {
  try {
    const keep = new Set(liveCallIds.map(callNotificationId));
    const displayed = await notifee.getDisplayedNotifications();
    const stale = displayed
      .map(entry => entry.id ?? '')
      .filter(id => id.startsWith('call:') && !keep.has(id));
    await Promise.all(
      stale.map(id => notifee.cancelNotification(id).catch(() => undefined)),
    );
    return stale.map(id => id.slice('call:'.length));
  } catch (error) {
    console.log('[push] reconcile call notifications error', error);
    return [];
  }
}