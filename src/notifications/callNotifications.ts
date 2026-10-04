import notifee, {
  AndroidCategory,
  AndroidImportance,
  AndroidVisibility,
} from '@notifee/react-native';

export const MESSAGE_CHANNEL_ID = 'default';
export const CALL_CHANNEL_ID = 'incoming_call_v2';
const SYSTEM_RINGTONE_URI = 'content://settings/system/ringtone';

export const callNotificationId = (callId: string) => `call:${callId}`;

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
      visibility: AndroidVisibility.PUBLIC,
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
      timeoutAfter: 60000,
      visibility: AndroidVisibility.PUBLIC,
      smallIcon: 'ic_stat_call',
      fullScreenAction: { id: 'accept-call', launchActivity: 'default' },
      pressAction: { id: 'accept-call', launchActivity: 'default' },
      actions: [
        { title: 'Decline', pressAction: { id: 'decline-call' } },
        {
          title: 'Accept',
          pressAction: { id: 'accept-call', launchActivity: 'default' },
        },
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
        .filter(entry => (entry.id ?? '').startsWith('call:'))
        .map(entry => notifee.cancelNotification(entry.id as string)),
    );
  } catch (error) {
    console.log('[push] dismiss all call notifications error', error);
  }
}
