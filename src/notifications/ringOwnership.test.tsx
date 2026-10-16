/**
 * The two halves of the foreground/background ring handover, and the sound the
 * ring channel is born with.
 *
 * `foregroundRinging.test.tsx` states who owns the ring in the foreground. This
 * file states the two things that ownership only works if:
 *
 *   1. The ring is HANDED OVER when the app stops being visible. A native ring
 *      owned by a suspended JS runtime cannot show a ring screen over the
 *      keyguard, cannot be stopped by a terminal push, and dies with the process
 *      - so a call that arrived in the foreground and was then swiped away from
 *      would be unanswerable and un-declinable.
 *   2. The ring channel is born with a sound that can actually be played. The
 *      channel is immutable, so a URI written into it in error is permanent.
 */

import React from 'react';
import { AppState, NativeModules } from 'react-native';
import { act, create, ReactTestRenderer } from 'react-test-renderer';

const mockNavigate = jest.fn();
const mockAccept = jest.fn(async () => undefined);
const mockReject = jest.fn(async () => undefined);
const mockIncoming: { current: unknown } = { current: null };

jest.mock('../navigation/NavigationService', () => ({
  navigate: (...args: unknown[]) => mockNavigate(...args),
}));

jest.mock('../auth/SessionProvider', () => ({
  useSession: () => ({ token: 'token-1' }),
}));

jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return {
    SafeAreaView: View,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
  };
});

jest.mock('react-native-paper', () => ({
  useTheme: () => ({
    colors: {
      background: '#000',
      surface: '#111',
      surfaceVariant: '#222',
      onSurface: '#fff',
      onSurfaceVariant: '#aaa',
      outline: '#444',
      primary: '#fff',
      onPrimary: '#000',
      primaryContainer: '#eee',
      onPrimaryContainer: '#000',
    },
  }),
}));

jest.mock('../components/convex/UserAvatar', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('convex/react', () => ({
  useQuery: () => mockIncoming.current,
  useMutation: (reference: unknown) =>
    String(reference).includes('accept') ? mockAccept : mockReject,
}));

jest.mock('../../convex/_generated/api', () => ({
  api: {
    calls: {
      incoming: 'calls:incoming',
      accept: 'calls:accept',
      reject: 'calls:reject',
    },
  },
}));

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('@notifee/react-native', () => {
  const nc = Object.assign(jest.fn(), {
    displayNotification: jest.fn(async () => 'id'),
    cancelNotification: jest.fn(async () => {}),
    getDisplayedNotifications: jest.fn(async () => []),
    createChannel: jest.fn(async () => 'channel'),
    requestPermission: jest.fn(async () => ({ authorizationStatus: 1 })),
    getNotificationSettings: jest.fn(async () => ({
      authorizationStatus: 1,
      android: { importance: 4 },
    })),
    registerForegroundService: jest.fn(),
    stopForegroundService: jest.fn(async () => {}),
    onForegroundEvent: jest.fn(() => () => {}),
    onBackgroundEvent: jest.fn(() => {}),
    AndroidImportance: { DEFAULT: 3, HIGH: 4, MAX: 5 },
    AndroidCategory: { CALL: 'call', ALARM: 'alarm' },
    AndroidVisibility: { PUBLIC: 1, PRIVATE: 0, SECRET: -1 },
    EventType: {
      PRESS: 'press',
      ACTION_PRESS: 'actionPress',
      DELIVERED: 'delivered',
      DISMISSED: 'dismissed',
    },
  });
  return {
    __esModule: true,
    default: nc,
    AndroidImportance: nc.AndroidImportance,
    AndroidCategory: nc.AndroidCategory,
    AndroidVisibility: nc.AndroidVisibility,
    EventType: nc.EventType,
  };
});

const RINGING_CALL = {
  _id: 'call-handover',
  type: 'audio' as const,
  caller: {
    _id: 'user-2',
    displayName: 'Ada',
    username: 'ada',
    avatarUrl: null,
  },
};

const ringBridge = {
  start: jest.fn(async () => true),
  stop: jest.fn(async () => true),
};

const appStateListeners: Array<(state: string) => void> = [];

const renderOverlay = async (): Promise<ReactTestRenderer> => {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(React.createElement(require('../components/calls/IncomingCallOverlay').default));
  });
  return tree;
};

const emitAppState = async (state: string): Promise<void> => {
  await act(async () => {
    appStateListeners.forEach(listener => listener(state));
  });
};

beforeEach(() => {
  (NativeModules as Record<string, unknown>).CallAudio = ringBridge;
  mockNavigate.mockReset();
  mockAccept.mockReset().mockResolvedValue(undefined);
  mockReject.mockReset().mockResolvedValue(undefined);
  mockIncoming.current = RINGING_CALL;
  ringBridge.start.mockClear();
  ringBridge.stop.mockClear();
  appStateListeners.length = 0;
  // Notifee is a module-level mock, so its calls accumulate for the life of the
  // file. Every assertion here is about what THIS test did, so they start empty.
  const notifee = require('@notifee/react-native').default;
  notifee.displayNotification.mockClear();
  notifee.cancelNotification.mockClear();
  notifee.createChannel.mockClear();
  jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation(((type: string, handler: (s: string) => void) => {
      if (type === 'change') {
        appStateListeners.push(handler);
      }
      return { remove: () => undefined };
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('handing the ring between its owners', () => {
  it('hands the notification over on the way out, and stops the native ring', async () => {
    const tree = await renderOverlay();
    expect(ringBridge.start).toHaveBeenCalledWith(RINGING_CALL._id);
    ringBridge.stop.mockClear();

    await emitAppState('background');

    // The notification is what can ring with the app suspended, and it carries
    // the full-screen intent the native overlay cannot.
    const notifee = require('@notifee/react-native').default;
    expect(notifee.displayNotification).toHaveBeenCalledTimes(1);
    const posted = notifee.displayNotification.mock.calls[0][0];
    expect(posted.id).toBe(`call:${RINGING_CALL._id}`);
    expect(posted.android.loopSound).toBe(true);
    expect(posted.android.actions).toHaveLength(2);
    // Only once the notification is up does the native ring go away, or the
    // call is briefly silent.
    expect(ringBridge.stop).toHaveBeenCalledTimes(1);
    expect(ringBridge.stop).toHaveBeenCalledWith(RINGING_CALL._id);
    await act(async () => {
      tree.unmount();
    });
  });

  it('takes the ring back on the way in, without leaving the notification up', async () => {
    const tree = await renderOverlay();
    await emitAppState('background');
    ringBridge.start.mockClear();

    await emitAppState('active');

    const notifee = require('@notifee/react-native').default;
    expect(notifee.cancelNotification).toHaveBeenCalledWith(
      `call:${RINGING_CALL._id}`,
    );
    expect(ringBridge.start).toHaveBeenCalledWith(RINGING_CALL._id);
    await act(async () => {
      tree.unmount();
    });
  });

  it('does not restart the ring for an `inactive` bounce from the shade', async () => {
    const tree = await renderOverlay();
    // Android reports a notification-shade pull as inactive -> active. Treating
    // that as a handover would restart the ringtone from its first bar.
    await emitAppState('inactive');
    await emitAppState('active');

    const notifee = require('@notifee/react-native').default;
    expect(notifee.displayNotification).not.toHaveBeenCalled();
    expect(ringBridge.stop).not.toHaveBeenCalled();
    expect(ringBridge.start).toHaveBeenCalledTimes(1);
    await act(async () => {
      tree.unmount();
    });
  });

  it('does not hand anything over for a call that is not ringing', async () => {
    mockIncoming.current = null;
    const tree = await renderOverlay();
    await emitAppState('background');

    const notifee = require('@notifee/react-native').default;
    expect(notifee.displayNotification).not.toHaveBeenCalled();
    expect(ringBridge.start).not.toHaveBeenCalled();
    await act(async () => {
      tree.unmount();
    });
  });
});

describe('ring bridge ownership', () => {
  const loadBridge = async () => {
    let mod!: typeof import('./foregroundRinging');
    await act(async () => {
      mod = require('./foregroundRinging');
    });
    return mod;
  };

  it('ignores a stop for a call it is not ringing', async () => {
    const { IncomingCallRingBridge } = await loadBridge();
    await IncomingCallRingBridge.start('call-a');
    ringBridge.stop.mockClear();

    // A late stop belonging to an answered call must not silence the next one.
    await expect(IncomingCallRingBridge.stop('call-b')).resolves.toBe(false);
    expect(ringBridge.stop).not.toHaveBeenCalled();
    await IncomingCallRingBridge.stop('call-a');
  });

  it('does not restart a ring it already owns', async () => {
    const { IncomingCallRingBridge } = await loadBridge();
    await IncomingCallRingBridge.start('call-c');
    ringBridge.start.mockClear();

    await IncomingCallRingBridge.start('call-c');
    expect(ringBridge.start).not.toHaveBeenCalled();
    await IncomingCallRingBridge.stop('call-c');
  });

  it('replaces one ring with the next rather than layering them', async () => {
    const { IncomingCallRingBridge } = await loadBridge();
    await IncomingCallRingBridge.start('call-d');
    await IncomingCallRingBridge.start('call-e');

    expect(ringBridge.stop).toHaveBeenCalledWith('call-d');
    expect(ringBridge.start).toHaveBeenCalledWith('call-e');
    await IncomingCallRingBridge.stop('call-e');
  });
});

describe('the sound the ring channel is born with', () => {
  /**
   * `channelsReady` is module scope and the channel is created once, so each case
   * needs its own module registry - otherwise the second assertion is reading the
   * first case's channel and would pass for the wrong reason.
   */
  const ringSoundWith = async (
    uri: string | null,
    playable: boolean,
  ): Promise<string | undefined> => {
    jest.resetModules();
    // After `resetModules` the module registry hands out a fresh `react-native`,
    // and with it a fresh `Platform` back at the preset's iOS. `resolveRingSound`
    // only asks the platform on Android, so it has to be set in HERE, on the same
    // instance the module under test is about to read.
    (require('react-native').Platform as unknown as { OS: string }).OS = 'android';
    (NativeModules as Record<string, unknown>).CallAudio = {
      getDefaultRingtoneUri: jest.fn(async () => uri),
      isRingtonePlayable: jest.fn(async () => playable),
      start: ringBridge.start,
      stop: ringBridge.stop,
    };
    const notifee = require('@notifee/react-native').default;
    notifee.createChannel.mockClear();
    const {
      CALL_CHANNEL_ID,
      showIncomingCallNotification,
    } = require('./callNotifications');
    await showIncomingCallNotification({
      callId: 'call-sound',
      callerName: 'Ada',
      type: 'audio',
    });
    const channel = notifee.createChannel.mock.calls
      .map((call: unknown[]) => call[0] as { id: string; sound: string })
      .find((entry: { id: string; sound: string }) => entry.id === CALL_CHANNEL_ID);
    return channel?.sound;
  };

  it('uses the device ringtone when it can actually be played', async () => {
    await expect(
      ringSoundWith('content://media/internal/audio/media/42', true),
    ).resolves.toBe('content://media/internal/audio/media/42');
  });

  it('falls back to the bundled clip when the device ringtone will not resolve', async () => {
    // Non-empty and unplayable is the case that produced a permanently silent
    // ring: the channel is immutable, so this URI would have been frozen in.
    await expect(ringSoundWith('content://broken/uri', false)).resolves.toBe(
      'ringtone',
    );
  });

  it('falls back to the bundled clip when the user has no ringtone', async () => {
    await expect(ringSoundWith(null, true)).resolves.toBe('ringtone');
    await expect(ringSoundWith('   ', true)).resolves.toBe('ringtone');
  });
});
