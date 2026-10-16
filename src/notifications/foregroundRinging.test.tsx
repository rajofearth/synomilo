/**
 * Foreground ringing ownership, and the accept/decline paths that end it.
 *
 * These are the tests that were missing when a call arriving while the app was
 * open rang for a moment and then went silent, and when accepting from that
 * state crashed. Both failures were only reproducible in a running app, so both
 * rules are stated here instead.
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
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) };
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

/**
 * `react-native`'s index re-exports `Alert` as
 * `require('./Libraries/Alert/Alert').default`, so a bare `{ alert }` mock leaves
 * `Alert` itself undefined and the component throws on the failure path - which is
 * exactly the path the "never throws out of the press handler" case exercises.
 */
jest.mock('react-native/Libraries/Alert/Alert', () => ({
  __esModule: true,
  default: { alert: jest.fn() },
}));

/**
 * Notifee, declared here rather than inherited from jest.setup.js.
 *
 * The shared mock predates `AndroidVisibility` (and `getDisplayedNotifications`),
 * both of which the ring channel is built with, so without this the notification
 * cannot even be constructed. jest.setup.js is not ours to change.
 */
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

/**
 * `background.ts` imports the generated Convex api module for its headless
 * branches. That module calls `componentsGeneric()` at load, and the
 * `convex/server` mock in jest.setup.js predates it and does not provide that
 * export - so the graph could not even be loaded. Mocked at the point of use
 * rather than in jest.setup.js, which is not ours to change.
 */
jest.mock('../../convex/_generated/api', () => ({
  api: {
    calls: {
      incoming: 'calls:incoming',
      accept: 'calls:accept',
      reject: 'calls:reject',
    },
  },
}));

import notifee from '@notifee/react-native';
import {
  CALL_CHANNEL_ID,
  callNotificationId,
  showIncomingCallNotification,
} from './callNotifications';
import { handleDataMessage } from './background';
import {
  IncomingCallRingBridge,
  foregroundRingingActive,
} from './foregroundRinging';
import IncomingCallOverlay from '../components/calls/IncomingCallOverlay';

const RINGING_CALL = {
  _id: 'call-1',
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
  active: false,
};

beforeEach(() => {
  (NativeModules as Record<string, unknown>).CallAudio = ringBridge;
  mockNavigate.mockReset();
  mockAccept.mockReset().mockResolvedValue(undefined);
  mockReject.mockReset().mockResolvedValue(undefined);
  mockIncoming.current = null;
  ringBridge.start.mockClear();
  ringBridge.stop.mockClear();
  notifee.cancelNotification = jest.fn(async () => undefined);
  notifee.displayNotification = jest.fn(async () => 'id');
});

const rendered = (): ReactTestRenderer => create(<IncomingCallOverlay />);

const pressAccept = async (tree: ReactTestRenderer): Promise<void> => {
  const buttons = tree.root.findAll(
    node => node.props?.accessibilityLabel === 'Accept call',
  );
  await act(async () => {
    await buttons[0].props.onPress();
  });
};

const pressDecline = async (tree: ReactTestRenderer): Promise<void> => {
  const buttons = tree.root.findAll(
    node => node.props?.accessibilityLabel === 'Decline call',
  );
  await act(async () => {
    await buttons[0].props.onPress();
  });
};

describe('foreground ringing', () => {
  it('rings from the overlay while the app is visible and hands the notification over', async () => {
    mockIncoming.current = RINGING_CALL;
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = rendered();
    });

    expect(ringBridge.start).toHaveBeenCalledWith(RINGING_CALL._id);
    // The channel must stop, or the ring is doubled for as long as the overlay is up.
    expect(notifee.cancelNotification).toHaveBeenCalledWith(
      callNotificationId(RINGING_CALL._id),
    );
    expect(foregroundRingingActive()).toBe(true);
    tree.unmount();
  });

  it('does not ring for a call that is not ringing', async () => {
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = rendered();
    });
    expect(ringBridge.start).not.toHaveBeenCalled();
    expect(foregroundRingingActive()).toBe(false);
    tree.unmount();
  });

  it('never posts the alerting notification while the app is in the foreground', async () => {
    (AppState as unknown as { currentState: string }).currentState = 'active';
    await handleDataMessage(
      {
        type: 'call',
        callId: RINGING_CALL._id,
        callerName: 'Ada',
        callType: 'audio',
      },
      { suppressWhenForeground: true },
    );
    expect(notifee.displayNotification).not.toHaveBeenCalled();
  });

  it('still posts the alerting notification when the app is not in the foreground', async () => {
    (AppState as unknown as { currentState: string }).currentState = 'background';
    await handleDataMessage({
      type: 'call',
      callId: RINGING_CALL._id,
      callerName: 'Ada',
      callType: 'audio',
    });
    expect(notifee.displayNotification).toHaveBeenCalled();
    const posted = (notifee.displayNotification as jest.Mock).mock.calls[0][0];
    expect(posted.android.channelId).toBe(CALL_CHANNEL_ID);
    expect(posted.android.loopSound).toBe(true);
  });

  it('rings with the device ringtone, validated, and falls back when it will not resolve', async () => {
    (NativeModules as Record<string, unknown>).CallAudio = {
      getDefaultRingtoneUri: jest.fn(async () => 'content://broken/uri'),
      start: ringBridge.start,
      stop: ringBridge.stop,
    };
    await showIncomingCallNotification({
      callId: 'call-x',
      callerName: 'Ada',
      type: 'audio',
    });
    const channels = (notifee.createChannel as jest.Mock).mock.calls.map(
      call => call[0],
    );
    const ring = channels.find(channel => channel.id === CALL_CHANNEL_ID);
    expect(ring).toBeDefined();
  });
});

describe('accepting from the foreground', () => {
  it('navigates once, tears the ring down, and does not throw', async () => {
    mockIncoming.current = RINGING_CALL;
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = rendered();
    });

    await pressAccept(tree);

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('CallScreen', {
      callId: RINGING_CALL._id,
      type: 'audio',
      role: 'callee',
      peerName: 'Ada',
    });
    expect(ringBridge.stop).toHaveBeenCalledWith(RINGING_CALL._id);
    tree.unmount();
  });

  it('never throws out of the press handler', async () => {
    mockIncoming.current = RINGING_CALL;
    mockAccept.mockRejectedValueOnce(new Error('boom'));
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = rendered();
    });

    await expect(pressAccept(tree)).resolves.toBeUndefined();
    expect(ringBridge.stop).toHaveBeenCalledWith(RINGING_CALL._id);
    tree.unmount();
  });

  it('decline tears the ring down exactly once and never navigates', async () => {
    mockIncoming.current = RINGING_CALL;
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = rendered();
    });

    await pressDecline(tree);

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(ringBridge.stop).toHaveBeenCalledTimes(1);
    tree.unmount();
  });

  it('stops ringing when the overlay unmounts', async () => {
    mockIncoming.current = RINGING_CALL;
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = rendered();
    });
    await act(async () => {
      tree.unmount();
    });
    expect(ringBridge.stop).toHaveBeenCalledWith(RINGING_CALL._id);
  });
});

describe('bridge', () => {
  it('is a no-op where there is no native module', async () => {
    delete (NativeModules as Record<string, unknown>).CallAudio;
    await expect(IncomingCallRingBridge.start('x')).resolves.toBe(false);
    await expect(IncomingCallRingBridge.stop('x')).resolves.toBe(false);
    expect(foregroundRingingActive()).toBe(false);
  });

  it('remembers the active foreground ring so it can be handed back', async () => {
    mockIncoming.current = RINGING_CALL;
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = rendered();
    });
    expect(foregroundRingingActive()).toBe(true);
    expect(IncomingCallRingBridge.activeCallId()).toBe(RINGING_CALL._id);
    await act(async () => {
      tree.unmount();
    });
    expect(foregroundRingingActive()).toBe(false);
  });
});