import 'react-native-url-polyfill/auto';
import { AppState, NativeModules, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import notifee, { EventType } from '@notifee/react-native';
import { api } from '../../convex/_generated/api';
import {
  dismissCallNotification,
  showIncomingCallNotification,
} from './callNotifications';
import {
  handleOngoingCallAction,
  ONGOING_ACTION_HANGUP,
  ONGOING_ACTION_MUTE,
  ONGOING_ACTION_SPEAKER,
} from './ongoingCall';
import { headlessConvexClient, readSessionToken } from './convexHeadless';

export const PENDING_CALL_KEY = 'synomilo.pendingCall';
/**
 * Was 120_000 - double the server's RING_TIMEOUT_MS (60_000). A pending accept could
 * therefore outlive the call it referred to, and the user would tap Accept on a ring
 * for a call that had already been marked missed, which surfaces as
 * "This call is no longer ringing".
 */
const PENDING_CALL_TTL_MS = 60000;

export type PendingCallAction = 'accept' | 'resume';

export interface PendingCall {
  callId: string;
  callType: 'audio' | 'video';
  callerName: string;
  /**
   * `accept` came off a ringing notification and still has to run `calls.accept`.
   * `resume` came off the ongoing-call notification for a call that is already
   * live - accepting there again would throw and, on one of the call sites, pop a
   * spurious "Could not answer" alert over a connected call.
   */
  action: PendingCallAction;
  at: number;
}

/**
 * Headless entry point for FCM data messages. Only incoming-call messages need
 * client-side work: everything else is displayed by the system notification.
 *
 * `suppressWhenForeground` is passed ONLY by the foreground handler in App.tsx
 * (`messaging().onMessage`, which by definition only fires while the app is
 * visible). It is deliberately not derived from `AppState` inside this function:
 * this also runs from `index.js`'s background handler, and in a headless JS task on
 * a killed app no lifecycle callback has ever fired, so `AppState.currentState`
 * there is not evidence that anyone is looking at the screen. Getting that wrong
 * means either double-ringing in the foreground or - far worse - silently never
 * ringing in the background.
 */
export async function handleDataMessage(
  data: Record<string, unknown> | undefined,
  options?: { suppressWhenForeground?: boolean },
): Promise<void> {
  if (!data || data.type !== 'call' || typeof data.callId !== 'string') {
    return;
  }

  // Terminal signals. These do not exist on the server today (convex/calls.ts
  // `end`/`markTimedOut` schedule no push), but honouring them costs nothing and
  // means the client is already correct the moment the backend lands them.
  const callAction = typeof data.callAction === 'string' ? data.callAction : '';
  if (callAction === 'cancelled' || callAction === 'ended') {
    await teardownRinging(data.callId);
    return;
  }

  if (options?.suppressWhenForeground && AppState.currentState === 'active') {
    // `IncomingCallOverlay` is already showing a full-screen Accept/Decline card
    // for this call, driven by a live Convex query. Posting the notification too
    // gave the user two racing Accept buttons for the same call.
    return;
  }

  await showIncomingCallNotification({
    callId: data.callId,
    callerName:
      typeof data.callerName === 'string' ? data.callerName : 'Unknown',
    type: data.callType === 'video' ? 'video' : 'audio',
  });
}

/**
 * Stop everything a ringing call put up: the notification, any deferred accept, and
 * the lock-screen ring activity. Idempotent - it can be reached from a background
 * push that is delivered twice and from a decline.
 *
 * `dismissActivity` is false when the ring screen has already finished itself
 * (the user just tapped its own Accept or Decline button).
 */
export async function teardownRinging(
  callId: string,
  dismissActivity = true,
): Promise<void> {
  await dismissCallNotification(callId);
  try {
    await AsyncStorage.removeItem(PENDING_CALL_KEY);
  } catch {}
  if (dismissActivity) {
    await dismissRingingActivity();
  }
}

/**
 * Finishes `IncomingCallActivity` if it is on screen.
 *
 * The activity is `noHistory` and self-dismisses after the ring window, but
 * declining from the notification must not leave a live ring screen behind the
 * notification shade.
 */
async function dismissRingingActivity(): Promise<void> {
  if (Platform.OS !== 'android') {
    return;
  }
  try {
    const bridge = NativeModules.CallIntent as
      | { dismissRingScreen?: () => Promise<boolean> }
      | undefined;
    await bridge?.dismissRingScreen?.();
  } catch {}
}

async function rejectCallHeadless(callId: string): Promise<void> {
  try {
    const token = await readSessionToken();
    if (!token) {
      console.warn('[push] headless decline skipped: no stored session token');
      return;
    }
    await headlessConvexClient().mutation(api.calls.reject, {
      token,
      callId: callId as any,
    });
  } catch (error) {
    console.warn('[push] headless reject failed', error);
  }
}

export async function rememberPendingCall(pending: PendingCall): Promise<void> {
  try {
    await AsyncStorage.setItem(PENDING_CALL_KEY, JSON.stringify(pending));
  } catch (error) {
    console.log('[push] remember pending call failed', error);
  }
}

export async function consumePendingCall(): Promise<PendingCall | null> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_CALL_KEY);
    if (!raw) {
      return null;
    }
    await AsyncStorage.removeItem(PENDING_CALL_KEY);
    const parsed = JSON.parse(raw) as PendingCall;
    if (!parsed?.callId) {
      return null;
    }
    if (parsed.action !== 'accept' && parsed.action !== 'resume') {
      return null;
    }
    if (Date.now() - (parsed.at ?? 0) > PENDING_CALL_TTL_MS) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Runs in a headless JS context (app backgrounded or killed) for presses and action
 * buttons on call notifications. Accepting is deferred to the app via AsyncStorage
 * because navigation requires the foreground UI.
 */
export async function handleNotifeeBackgroundEvent(event: any): Promise<void> {
  const { type, detail } = event ?? {};
  const data = (detail?.notification?.data ?? {}) as Record<string, string>;
  const actionId = detail?.pressAction?.id ?? '';

  // Ongoing-call actions first: they carry a callId too, and routing them through
  // the ringing branch below would try to `calls.reject` a call that is live.
  if (
    actionId === ONGOING_ACTION_MUTE ||
    actionId === ONGOING_ACTION_SPEAKER ||
    actionId === ONGOING_ACTION_HANGUP
  ) {
    await handleOngoingCallAction(data, actionId);
    return;
  }

  if ((data.type ?? '') === 'ongoing') {
    if (actionId === 'open-ongoing-call' || type === EventType.PRESS) {
      // Tapping the ongoing notification must land the user back in the call. It
      // must NOT accept anything - the call is already live.
      await rememberPendingCall({
        callId: data.callId,
        callType: data.callType === 'video' ? 'video' : 'audio',
        callerName: data.peerName ?? 'Unknown',
        action: 'resume',
        at: Date.now(),
      });
    }
    return;
  }

  const callId = data.callId;
  if (!callId) {
    return;
  }

  if (actionId === 'decline-call' || type === EventType.DISMISSED) {
    await rejectCallHeadless(callId);
    await teardownRinging(callId);
    return;
  }

  if (actionId === 'open-call') {
    // Body press / full-screen intent. Notifee has already started
    // IncomingCallActivity (its pressAction carries launchActivity), and that
    // activity hands Accept/Decline back through CallIntent. Doing an accept here
    // as well is how "a body tap auto-answers" happened.
    return;
  }

  if (actionId === 'accept-call') {
    // The notification's Accept action. No launchActivity, so the headless task
    // has to both defer the accept and bring the app forward itself.
    await rememberPendingCall({
      callId,
      callType: data.callType === 'video' ? 'video' : 'audio',
      callerName: data.callerName ?? 'Unknown',
      action: 'accept',
      at: Date.now(),
    });
    await dismissCallNotification(callId);
    await openApp();
  }
}

/**
 * Start MainActivity from a headless JS context. There is no JS API for this and
 * `Linking` cannot reach an unexported component, so it goes through the
 * `CallIntent` native module.
 */
async function openApp(): Promise<void> {
  if (Platform.OS !== 'android') {
    return;
  }
  try {
    const bridge = NativeModules.CallIntent as
      | { openApp?: () => Promise<boolean> }
      | undefined;
    await bridge?.openApp?.();
  } catch {}
}

export { notifee };