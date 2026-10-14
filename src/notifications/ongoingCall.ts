import notifee, {
  AndroidCategory,
  AndroidVisibility,
} from '@notifee/react-native';
import { api } from '../../convex/_generated/api';
import {
  ONGOING_CHANNEL_ID,
  ensureNotificationChannels,
  ongoingNotificationId,
} from './callNotifications';
import {
  callMediaState,
  releaseAudioRoute,
  type CallMediaFlags,
} from './callMediaState';
import { headlessConvexClient, readSessionToken } from './convexHeadless';

export const ONGOING_ACTION_MUTE = 'toggle-mute';
export const ONGOING_ACTION_SPEAKER = 'toggle-speaker';
export const ONGOING_ACTION_HANGUP = 'hangup-call';

export interface OngoingCallInfo {
  callId: string;
  peerName: string;
  type: 'audio' | 'video';
  /**
   * SERVER timestamp for when the call was answered (`convex/calls.ts accept`
   * writes `Date.now()` on the Convex clock).
   */
  answeredAt: number;
  /**
   * `serverNow - deviceNow`, from `deriveClockOffset`. Optional because
   * `calls.get` does not always carry `serverNow` yet.
   */
  clockOffset?: number | null;
}

let foregroundServiceRegistered = false;

function actionLabels(state: CallMediaFlags) {
  return {
    mute: state.muted ? 'Unmute' : 'Mute',
    speaker: state.speakerOn ? 'Earpiece' : 'Speaker',
  };
}

/**
 * The ongoing-call notification. It did not exist: `notifee.displayNotification`
 * was called in exactly one place in the whole app and only for an inbound ring,
 * which is why minimising mid-call produced nothing at all.
 *
 * Chronometer anchoring, which is the part that is easy to get wrong: the OS
 * renders `timestamp + (now - System.currentTimeMillis())`, i.e. it works entirely
 * on the DEVICE clock, while `answeredAt` was written by the SERVER clock. Feeding
 * the raw server timestamp makes the duration wrong by exactly the clock skew -
 * which is the same defect that made the in-call screen print "-1:-3". So the
 * anchor is `answeredAt - clockOffset`: still derived from the server timestamp,
 * re-expressed on this device's timeline. Never an incrementing counter.
 */
export async function showOngoingCallNotification(
  call: OngoingCallInfo,
): Promise<void> {
  await ensureNotificationChannels();

  if (!foregroundServiceRegistered) {
    // Notifee allows exactly one foreground-service notification at a time. The
    // ringing notification is a normal notification, so they never collide.
    notifee.registerForegroundService(() => new Promise(() => {}));
    foregroundServiceRegistered = true;
  }

  const state = callMediaState.get();
  const labels = actionLabels(state);
  const anchor = call.answeredAt - (call.clockOffset ?? 0);

  await notifee.displayNotification({
    id: ongoingNotificationId(call.callId),
    title: call.peerName,
    body: call.type === 'video' ? 'Video call' : 'Voice call',
    data: {
      type: 'ongoing',
      callId: call.callId,
      callType: call.type,
      peerName: call.peerName,
    },
    android: {
      channelId: ONGOING_CHANNEL_ID,
      category: AndroidCategory.CALL,
      // Keeps the process alive for the length of the call. Without it Android
      // freezes/kills the JS runtime and the P2P peer connection with it, which is
      // the other half of "I minimised the app and the call just died".
      asForegroundService: true,
      ongoing: true,
      autoCancel: false,
      // Re-posting this notification on every state change (mute, speaker) must
      // not re-alert. The channel is silent, but onlyAlertOnce also suppresses the
      // heads-up animation.
      onlyAlertOnce: true,
      timestamp: anchor,
      showChronometer: true,
      chronometerDirection: 'up',
      visibility: AndroidVisibility.PUBLIC,
      smallIcon: 'ic_stat_call',
      tag: ongoingNotificationId(call.callId),
      pressAction: { id: 'open-ongoing-call' },
      actions: [
        { title: labels.mute, pressAction: { id: ONGOING_ACTION_MUTE } },
        { title: labels.speaker, pressAction: { id: ONGOING_ACTION_SPEAKER } },
        { title: 'End', pressAction: { id: ONGOING_ACTION_HANGUP } },
      ],
      showTimestamp: false,
    },
  });
}

export async function hideOngoingCallNotification(
  callId: string,
): Promise<void> {
  try {
    await notifee.cancelNotification(ongoingNotificationId(callId));
  } catch (error) {
    console.log('[push] hide ongoing notification error', error);
  }
  if (foregroundServiceRegistered) {
    try {
      await notifee.stopForegroundService();
    } catch {}
    foregroundServiceRegistered = false;
  }
  callMediaState.reset();
  await releaseAudioRoute();
}

/**
 * Routes an ongoing-call notification action. Runs in whatever context Notifee
 * dispatches it in - the mounted app when the process is alive, a headless task
 * when it is not - so it must not touch React state directly.
 */
export async function handleOngoingCallAction(
  data: Record<string, string | undefined>,
  actionId: string,
): Promise<void> {
  const callId = data.callId;
  if (!callId) {
    return;
  }

  if (actionId === ONGOING_ACTION_MUTE) {
    callMediaState.set({ muted: !callMediaState.get().muted });
    await refreshOngoingCallActions(callId);
    return;
  }

  if (actionId === ONGOING_ACTION_SPEAKER) {
    callMediaState.set({
      speakerOn: !callMediaState.get().speakerOn,
    });
    await refreshOngoingCallActions(callId);
    return;
  }

  if (actionId === ONGOING_ACTION_HANGUP) {
    const token = await readSessionToken();
    if (token) {
      try {
        await headlessConvexClient().mutation(api.calls.end, {
          token,
          callId: callId as any,
        });
      } catch (error) {
        console.log('[push] notification hangup failed', error);
      }
    }
    await hideOngoingCallNotification(callId);
  }
}

/**
 * Re-post the notification so the action titles track state ("Mute" -> "Unmute").
 * Android rebuilds the action row on every update, so this has to be a real
 * displayNotification call; `onlyAlertOnce` is what keeps it silent.
 *
 * Never creates the notification - it no-ops when nothing is displayed, so
 * toggling mute from the in-call button cannot pop a notification over a call the
 * user is already looking at.
 */
export async function refreshOngoingCallActions(callId: string): Promise<void> {
  try {
    const state = callMediaState.get();
    const displayed = await notifee.getDisplayedNotifications();
    const entry = displayed.find(
      item => item.id === ongoingNotificationId(callId),
    );
    if (!entry) {
      return;
    }
    const labels = actionLabels(state);
    await notifee.displayNotification({
      ...entry.notification,
      android: {
        ...entry.notification.android,
        actions: [
          { title: labels.mute, pressAction: { id: ONGOING_ACTION_MUTE } },
          {
            title: labels.speaker,
            pressAction: { id: ONGOING_ACTION_SPEAKER },
          },
          { title: 'End', pressAction: { id: ONGOING_ACTION_HANGUP } },
        ],
      },
    });
  } catch (error) {
    console.log('[push] refresh ongoing actions error', error);
  }
}