/**
 * The call screen's wiring of the connection lifecycle, end to end.
 *
 * `callLinkRecovery.test.ts` proves the state machine. This proves the things only
 * the screen can prove:
 *
 *  - a call that drops is RECOVERED, not ended - no `calls.end` reaches the server,
 *    so the peer is never told the call is over because this side is looking for a
 *    new network path;
 *  - `restartIce()` is actually called on the live peer connection, followed by an
 *    offer that carries `iceRestart`;
 *  - a `ConnectivityManager` handover - Wi-Fi to LTE - asks for that restart itself,
 *    rather than waiting for ICE to notice;
 *  - the peer is told exactly once, and only when recovery is genuinely exhausted.
 *
 * The peer connection is a hand-written fake rather than a mock object so the test
 * drives the transitions libwebrtc would: `connectionState` / `iceConnectionState`
 * changes and offers being created and applied.
 */

import React from 'react';
import {
  AppState,
  DeviceEventEmitter,
  NativeModules,
  PermissionsAndroid,
  Platform,
} from 'react-native';
import { act, create, ReactTestRenderer } from 'react-test-renderer';

type Listener = (payload: any) => void;

/** Instances the fake peer connection has handed out, newest last. */
const mockPeerConnections: any[] = [];

jest.mock('react-native-webrtc', () => {
  class FakePeerConnection {
    connectionState = 'new';
    iceConnectionState = 'new';
    signalingState = 'stable';
    localDescription: any = null;
    remoteDescription: any = { type: 'offer', sdp: 'v=0' };
    offers: any[] = [];

    restartIce = jest.fn();
    createOffer = jest.fn(async (options?: any) => {
      this.offers.push(options);
      return { type: 'offer', sdp: 'v=0' };
    });
    createAnswer = jest.fn(async () => ({ type: 'answer', sdp: 'v=0' }));
    setLocalDescription = jest.fn(async (desc: any) => {
      this.localDescription = desc;
      // libwebrtc is `stable` again once a local description has been applied.
      this.signalingState = 'stable';
    });
    setRemoteDescription = jest.fn(async (desc: any) => {
      this.remoteDescription = desc;
    });
    addIceCandidate = jest.fn(async () => undefined);
    addTrack = jest.fn();
    close = jest.fn(() => {
      this.connectionState = 'closed';
    });

    private listeners = new Map<string, Set<Listener>>();

    addEventListener(event: string, handler: Listener) {
      if (!this.listeners.has(event)) {
        this.listeners.set(event, new Set());
      }
      this.listeners.get(event)!.add(handler);
    }

    removeEventListener(event: string, handler: Listener) {
      this.listeners.get(event)?.delete(handler);
    }

    private emit(event: string) {
      this.listeners.get(event)?.forEach(handler => handler({}));
    }

    /** Drive a transition the way libwebrtc would. */
    setStates(connectionState: string, iceConnectionState: string) {
      this.connectionState = connectionState;
      this.iceConnectionState = iceConnectionState;
      this.emit('connectionstatechange');
      this.emit('iceconnectionstatechange');
    }

    constructor() {
      mockPeerConnections.push(this);
    }
  }

  return {
    RTCPeerConnection: FakePeerConnection,
    RTCIceCandidate: class {},
    RTCSessionDescription: class {},
    RTCView: require('react-native').View,
    mediaDevices: {
      getUserMedia: jest.fn(async () => ({
        toURL: () => 'stream-local',
        release: jest.fn(),
        getTracks: () => [],
        getAudioTracks: () => [],
        getVideoTracks: () => [],
      })),
      getDisplayMedia: jest.fn(),
    },
    MediaStream: class {},
    MediaStreamTrack: class {},
    registerGlobals: jest.fn(),
  };
});

const mockSignal = jest.fn(async (..._args: any[]) => undefined);
const mockConsumeSignals = jest.fn(async (..._args: any[]) => undefined);
const mockEndCall = jest.fn(async (..._args: any[]) => undefined);
const mockHideOngoing = jest.fn(async (..._args: any[]) => undefined);
const mockPrepareAudioRoute = jest.fn(async (..._args: any[]) => true);
const mockNetworkStart = jest.fn(async () => true);
const mockNetworkStop = jest.fn(async () => true);

let mockCallRow: any = null;
let mockSignals: any[] = [];

jest.mock('convex/react', () => ({
  useQuery: (reference: any) => {
    const name = String(reference);
    return name.includes('calls:get') ? mockCallRow : mockSignals;
  },
  useMutation: (reference: any) => {
    const name = String(reference);
    if (name.includes('consumeSignals')) {
      return mockConsumeSignals;
    }
    if (name.includes('calls:end')) {
      return mockEndCall;
    }
    if (name.includes('signal')) {
      return mockSignal;
    }
    return jest.fn(async () => undefined);
  },
}));

jest.mock('../../../convex/_generated/api', () => ({
  api: {
    calls: {
      get: 'calls:get',
      signals: 'calls:signals',
      signal: 'calls:signal',
      consumeSignals: 'calls:consumeSignals',
      end: 'calls:end',
    },
  },
}));

jest.mock('../../auth/SessionProvider', () => ({
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
      scrim: '#000',
      onSurface: '#fff',
      onSurfaceVariant: '#aaa',
      primary: '#0f0',
      onPrimary: '#000',
      primaryContainer: '#eee',
      onPrimaryContainer: '#000',
    },
  }),
}));

jest.mock('@react-native-vector-icons/material-design-icons', () => {
  const { Text } = require('react-native');
  const react = require('react');
  return (props: any) => react.createElement(Text, null, props.name);
});

jest.mock('../convex/UserAvatar', () => {
  const { View } = require('react-native');
  const react = require('react');
  return () => react.createElement(View);
});

jest.mock('react-native-video', () => {
  const { View } = require('react-native');
  const react = require('react');
  return () => react.createElement(View);
});

jest.mock('../../notifications/callNotifications', () => ({
  cancelAllCallNotifications: jest.fn(async () => {}),
}));

jest.mock('../../notifications/ongoingCall', () => ({
  hideOngoingCallNotification: (...args: any[]) => mockHideOngoing(...(args as [])),
  showOngoingCallNotification: jest.fn(async () => {}),
  refreshOngoingCallActions: jest.fn(async () => {}),
}));

jest.mock('../../notifications/callMediaState', () => {
  const state = { muted: false, speakerOn: false };
  const listeners = new Set<Function>();
  return {
    callMediaState: {
      get: () => ({ ...state }),
      set: (patch: any) => {
        Object.assign(state, patch);
        listeners.forEach(listener => listener({ ...state }));
        return { ...state };
      },
      subscribe: (listener: Function) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      reset: () => {
        Object.assign(state, { muted: false, speakerOn: false });
      },
    },
    applyAudioRoute: jest.fn(async () => true),
    prepareCallAudioRoute: (...args: any[]) =>
      mockPrepareAudioRoute(...(args as [])),
    releaseAudioRoute: jest.fn(async () => {}),
  };
});

/** Matches `ACTIVE_CALL.answeredAt`, and the clock every test starts from. */
const START = 1_700_000_000_000;

/**
 * jest-circus schedules the per-test timeout on whatever `setTimeout` is installed,
 * and `jest.setup.js` installs fake timers for the whole file. So the ceiling is
 * measured in the fake time these tests deliberately travel through, not in wall
 * time. Each test spends at most a few seconds of it; the real run takes about
 * three. Without this the five-tick scenarios fail with "Exceeded timeout of 5000
 * ms" while only milliseconds have passed.
 */
jest.setTimeout(60_000);

const ACTIVE_CALL = {
  _id: 'call-1',
  status: 'active',
  answeredAt: START,
  serverNow: START,
  peer: { _id: 'user-2', displayName: 'Ada', username: 'ada', avatarUrl: null },
};

const route = {
  params: {
    callId: 'call-1',
    type: 'audio' as const,
    role: 'caller' as const,
    peerName: 'Ada',
  },
};

const goBack = jest.fn();
const navigation: any = {
  goBack,
  addListener: jest.fn(() => jest.fn()),
  setOptions: jest.fn(),
};

/**
 * Every tree this file renders, so `afterEach` can take them all down.
 *
 * Not optional bookkeeping. A screen left mounted keeps its one-second link
 * interval on the file-wide fake clock, and those intervals keep firing into the
 * *next* test - which then sees `calls.end` calls it did not make. That is how a
 * "tells the peer exactly once" assertion reads three.
 */
const mountedTrees: ReactTestRenderer[] = [];

const renderScreen = async (): Promise<ReactTestRenderer> => {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      React.createElement(require('./WebRTCCallScreen').default, {
        route,
        navigation,
      }),
    );
  });
  mountedTrees.push(tree);
  return tree;
};

const unmountScreen = async (tree: ReactTestRenderer) => {
  const index = mountedTrees.indexOf(tree);
  if (index >= 0) {
    mountedTrees.splice(index, 1);
  }
  await act(async () => {
    tree.unmount();
  });
};

afterEach(async () => {
  while (mountedTrees.length) {
    await unmountScreen(mountedTrees[mountedTrees.length - 1]);
  }
});

/**
 * Flush pending work and let real (fake-clock) timers due within `ms` run.
 *
 * Kept to small advances on purpose. `jest.setup.js` installs fake timers for the
 * whole file, and jest-circus schedules the per-test timeout on that same clock -
 * so a single `advanceTimersByTime(60000)` fires jest's own timeout and the test
 * dies with "Exceeded timeout" however much wall-clock time actually passed. Wall
 * time is moved with `jest.setSystemTime` instead, below.
 */
const settle = async (ms = 0) => {
  await act(async () => {
    jest.advanceTimersByTime(ms);
    await Promise.resolve();
  });
};

/**
 * Run the screen's one-second link tick with the call clock at `START + offsetMs`.
 *
 * The deadline is only ever evaluated on a tick, so one tick a long way into the
 * future is the decisive observation - and it costs 1000ms of fake time rather
 * than the ten minutes the scenario represents.
 */
const tickAt = async (offsetMs: number) => {
  jest.setSystemTime(START + offsetMs);
  await settle(1000);
};

/**
 * The `ConnectivityManager` reporting that the default network is now `networkKey`,
 * exactly as `CallNetworkModule` emits it. `NativeEventEmitter` forwards to
 * `DeviceEventEmitter` on every platform (`NativeEventEmitter.js:92`), which is the
 * same emitter the native module writes to.
 */
const networkBecame = async (networkKey: string | null) => {
  await act(async () => {
    DeviceEventEmitter.emit('CallNetwork:changed', {
      networkKey,
      connected: networkKey !== null,
    });
    await Promise.resolve();
  });
};

const latestPc = () => mockPeerConnections[mockPeerConnections.length - 1];

/** Bring the call up and leave it up long enough to blow the old deadline. */
const connectedCall = async () => {
  const tree = await renderScreen();
  const pc = latestPc();
  await act(async () => {
    pc.setStates('connected', 'connected');
  });
  // Ten minutes of a working call. The previous implementation armed its deadline
  // once and then treated every non-`connected` tick on a call this old as "never
  // going to connect", so the next blip ended it.
  await tickAt(600_000);
  expect(mockEndCall).not.toHaveBeenCalled();
  return { tree, pc };
};

beforeEach(() => {
  (Platform as any).OS = 'android';
  (AppState as any).currentState = 'active';
  jest.setSystemTime(START);
  (NativeModules as Record<string, unknown>).CallAudio = {
    useDefaultRoute: jest.fn(async () => true),
    setSpeakerOn: jest.fn(async () => true),
    releaseAudio: jest.fn(async () => true),
  };
  (NativeModules as Record<string, unknown>).CallNetwork = {
    start: mockNetworkStart,
    stop: mockNetworkStop,
    // `NativeEventEmitter` insists on both before it will attach.
    addListener: jest.fn(),
    removeListeners: jest.fn(),
  };
  (PermissionsAndroid as any).requestMultiple = jest.fn(async () => ({
    'android.permission.RECORD_AUDIO': 'granted',
  }));
  mockCallRow = { ...ACTIVE_CALL };
  mockSignals = [];
  mockPeerConnections.length = 0;
  mockSignal.mockClear().mockResolvedValue(undefined);
  mockConsumeSignals.mockClear().mockResolvedValue(undefined);
  mockEndCall.mockClear().mockResolvedValue(undefined);
  mockHideOngoing.mockClear().mockResolvedValue(undefined);
  mockPrepareAudioRoute.mockClear().mockResolvedValue(true);
  mockNetworkStart.mockClear().mockResolvedValue(true);
  mockNetworkStop.mockClear().mockResolvedValue(true);
  goBack.mockClear();
});

describe('a live call that drops', () => {
  it('recovers instead of ending, and never tells the peer', async () => {
    const { pc } = await connectedCall();

    await act(async () => {
      pc.setStates('disconnected', 'disconnected');
    });

    // Recovery, not a hangup. This is the whole point.
    expect(pc.restartIce).toHaveBeenCalledTimes(1);
    // And an offer that carries `iceRestart`, because `restartIce()` alone only
    // sets the flag libwebrtc consumes on the next local description.
    expect(pc.offers).toContainEqual({ iceRestart: true });
    expect(mockEndCall).not.toHaveBeenCalled();

    // It comes back, and the call carries on.
    await act(async () => {
      pc.setStates('connected', 'connected');
    });
    expect(mockEndCall).not.toHaveBeenCalled();
    await tickAt(900_000);
    expect(mockEndCall).not.toHaveBeenCalled();
  });

  it('recovers from an ICE failure the same way', async () => {
    const { pc } = await connectedCall();
    await act(async () => {
      pc.setStates('connecting', 'failed');
    });
    expect(pc.restartIce).toHaveBeenCalledTimes(1);
    expect(mockEndCall).not.toHaveBeenCalled();
  });

  it('does not tear the peer connection down on a blip', async () => {
    const { pc } = await connectedCall();
    await act(async () => {
      pc.setStates('disconnected', 'disconnected');
    });
    expect(pc.close).not.toHaveBeenCalled();
  });

  it('tells the peer exactly once, and only after the ladder is spent', async () => {
    const { pc } = await connectedCall();

    // Stuck down. Each recovery window is 20s, and there are two of them, so: the
    // drop spends attempt one, the first window running out spends attempt two, and
    // the second window running out is over budget and ends the call - once.
    await act(async () => {
      pc.setStates('disconnected', 'failed');
    });
    await tickAt(620_000);
    await tickAt(640_000);

    expect(mockEndCall).toHaveBeenCalledTimes(1);
    // Bounded: it stopped trying rather than restarting for ever.
    expect(pc.restartIce).toHaveBeenCalledTimes(2);

    // And it stays ended.
    await tickAt(700_000);
    await act(async () => {
      pc.setStates('disconnected', 'failed');
    });
    await tickAt(900_000);
    expect(mockEndCall).toHaveBeenCalledTimes(1);
  });

  it('sets up voice-call audio without forcing a route', async () => {
    await renderScreen();
    expect(mockPrepareAudioRoute).toHaveBeenCalledTimes(1);
  });

  it('gives up a call that never connected, with the connecting reason', async () => {
    await renderScreen();
    const pc = latestPc();
    // Never reaches `connected`; ICE simply never completes.
    for (const at of [25_000, 45_000, 65_000, 85_000, 105_000]) {
      await tickAt(at);
    }
    expect(pc.restartIce).toHaveBeenCalled();
    expect(mockEndCall).toHaveBeenCalledTimes(1);
    expect(mockEndCall.mock.calls[0][0]).toEqual({
      token: 'token-1',
      callId: 'call-1',
    });
  });
});

describe('the default network changing under a live call', () => {
  it('asks for an ICE restart instead of waiting for ICE to notice', async () => {
    const { pc } = await connectedCall();

    // The native module reports the network the call is on when it starts. That is
    // a baseline, not a handover: the candidates were just gathered on it.
    await networkBecame('Network{100}');
    expect(pc.restartIce).not.toHaveBeenCalled();

    // Wi-Fi out of range. The candidates just gathered describe an interface that
    // no longer exists, and `gather_once` means nothing will ever replace them.
    await networkBecame('Network{200}');
    expect(pc.restartIce).toHaveBeenCalledTimes(1);
    expect(pc.offers).toContainEqual({ iceRestart: true });
    // A handover is a recovery, not an ending: the peer is not told anything.
    expect(mockEndCall).not.toHaveBeenCalled();
  });

  it('ignores a repeat of the network it is already on', async () => {
    const { pc } = await connectedCall();
    await networkBecame('Network{100}');
    await networkBecame('Network{100}');
    await networkBecame('Network{100}');
    // `ConnectivityManager` re-reports capabilities and liveness on the same
    // network; only the identity changing is a handover.
    expect(pc.restartIce).not.toHaveBeenCalled();
  });

  it('recovers a call that had not connected yet either', async () => {
    await renderScreen();
    const pc = latestPc();
    await networkBecame('Network{100}');
    // Still inside the establishing window, so nothing was wrong - and the network
    // moving invalidates the handshake in progress.
    await networkBecame('Network{200}');
    expect(pc.restartIce).toHaveBeenCalledTimes(1);
    expect(mockEndCall).not.toHaveBeenCalled();
  });

  it('is bounded by the same ladder, and gives up exactly once', async () => {
    const { pc } = await connectedCall();
    await networkBecame('Network{100}');

    // Networks arriving faster than the ladder can be spent.
    await networkBecame('Network{200}');
    await networkBecame(null);
    await networkBecame('Network{300}');

    expect(pc.restartIce.mock.calls.length).toBeLessThanOrEqual(2);
    expect(mockEndCall).toHaveBeenCalledTimes(1);
  });

  it('leaves the network when the call screen goes away', async () => {
    const { tree } = await connectedCall();
    expect(mockNetworkStart).toHaveBeenCalledTimes(1);
    await unmountScreen(tree);
    // A ConnectivityManager callback held for the life of the process would keep
    // emitting into a call that no longer exists.
    expect(mockNetworkStop).toHaveBeenCalledTimes(1);
  });

  it('works with no native module at all, off the ICE states alone', async () => {
    delete (NativeModules as Record<string, unknown>).CallNetwork;
    const { pc } = await connectedCall();
    await act(async () => {
      pc.setStates('disconnected', 'disconnected');
    });
    expect(pc.restartIce).toHaveBeenCalledTimes(1);
    expect(mockEndCall).not.toHaveBeenCalled();
  });
});
