import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import notifee, { EventType } from '@notifee/react-native';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../../convex/_generated/api';
import { CONVEX_URL } from '../config/convexConfig';
import {
  dismissCallNotification,
  showIncomingCallNotification,
} from './callNotifications';

const TOKEN_KEY = 'synomilo.convex.token';
export const PENDING_CALL_KEY = 'synomilo.pendingCall';
const PENDING_CALL_TTL_MS = 120000;

export interface PendingCall {
  callId: string;
  callType: 'audio' | 'video';
  callerName: string;
  action: 'accept';
  at: number;
}

/**
 * Headless entry point for FCM data messages. Only incoming-call messages need
 * client-side work: everything else is displayed by the system notification.
 */
export async function handleDataMessage(
  data: Record<string, unknown> | undefined,
): Promise<void> {
  if (!data || data.type !== 'call' || typeof data.callId !== 'string') {
    return;
  }
  await showIncomingCallNotification({
    callId: data.callId,
    callerName:
      typeof data.callerName === 'string' ? data.callerName : 'Unknown',
    type: data.callType === 'video' ? 'video' : 'audio',
  });
}

async function rejectCallHeadless(callId: string): Promise<void> {
  try {
    const token = await AsyncStorage.getItem(TOKEN_KEY);
    if (!token) {
      return;
    }
    const client = new ConvexHttpClient(CONVEX_URL, {
      skipConvexDeploymentUrlCheck: true,
    });
    await client.mutation(api.calls.reject, { token, callId: callId as any });
  } catch (error) {
    console.log('[push] headless reject failed', error);
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
    if (!parsed?.callId || parsed.action !== 'accept') {
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
 * Runs in a headless JS context (app backgrounded or killed) for presses and
 * action buttons on call notifications. Accepting is deferred to the app via
 * AsyncStorage because navigation requires the foreground UI.
 */
export async function handleNotifeeBackgroundEvent(event: any): Promise<void> {
  const { type, detail } = event ?? {};
  const data = (detail?.notification?.data ?? {}) as Record<string, string>;
  const callId = data.callId;
  if (!callId) {
    return;
  }
  const actionId = detail?.pressAction?.id ?? '';

  if (actionId === 'decline-call' || type === EventType.DISMISSED) {
    await rejectCallHeadless(callId);
    await dismissCallNotification(callId);
    return;
  }

  if (
    actionId === 'accept-call' ||
    actionId === 'open-call' ||
    type === EventType.PRESS
  ) {
    await rememberPendingCall({
      callId,
      callType: data.callType === 'video' ? 'video' : 'audio',
      callerName: data.callerName ?? 'Unknown',
      action: 'accept',
      at: Date.now(),
    });
    await dismissCallNotification(callId);
  }
}

export { notifee };
