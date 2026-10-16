import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

/**
 * Probes for "the app lock does not work at all".
 *
 * Each test mounts the real gate against a mocked Keystore and a mocked
 * `BiometricGate`, then asserts on two things: whether the OS prompt was
 * actually raised, and what the user can see. The second half is the one that
 * matters most - a gate that arms and presents nothing is the worst outcome
 * there is, and it is the one nothing in the UI layer would have complained
 * about.
 */

jest.mock('@react-native-vector-icons/material-design-icons', () => {
  const { View } = require('react-native');
  return ({ name: _name, ...rest }: any) => <View {...rest} />;
});
/**
 * What `api.calls.incoming` answers. `null` is "no call ringing"; an object is
 * "a call is ringing". A holder rather than a `jest.fn`, because jest mock
 * factories may only close over names beginning with `mock` and the generic
 * signature of `jest.fn` varies between @types/jest majors.
 */
const mockIncoming: { current: unknown } = { current: null };
jest.mock('convex/react', () => ({
  useQuery: () => mockIncoming.current,
}));
jest.mock('../../../convex/_generated/api', () => ({
  api: { calls: { incoming: {} } },
  internal: {},
  components: {},
}));
jest.mock('../../auth/SessionProvider', () => ({
  useSession: jest.fn(() => ({ token: 'tok', signOut: jest.fn(async () => {}) })),
}));

const { NativeModules, Platform, AppState } = require('react-native');
(Platform as any).OS = 'android';
const AsyncStorage = require('@react-native-async-storage/async-storage');

const secureState: Record<string, string> = {};
const biometric = {
  getAvailability: jest.fn(async () => ({
    available: true,
    reason: 'ok',
    status: 0,
    deviceCredentialAvailable: true,
  })),
  authenticate: jest.fn(async () => ({ status: 'cancelled' })),
  setSecureWindow: jest.fn(async () => true),
  isSecureWindowEnabled: jest.fn(async () => true),
  cancel: jest.fn(),
};

let getItemImpl: (k: string) => Promise<string | null> = async k =>
  k in secureState ? secureState[k] : null;

/**
 * `getAllKeys` has to agree with `getItemImpl`, or the "the store was reset
 * under us" check reads keys the store can no longer produce and concludes the
 * reset never happened.
 */
const liveKeys = async () => {
  const out: string[] = [];
  for (const key of Object.keys(secureState)) {
    if ((await getItemImpl(key)) !== null) {
      out.push(key);
    }
  }
  return out;
};

NativeModules.SecureStore = {
  getItem: jest.fn((k: string) => getItemImpl(k)),
  setItem: jest.fn(async (k: string, v: string) => {
    secureState[k] = v;
    return null;
  }),
  removeItem: jest.fn(async (k: string) => {
    delete secureState[k];
    return null;
  }),
  getAllKeys: jest.fn(async () => liveKeys()),
  getBackendInfo: jest.fn(async () => ({ backend: 'encryptedSharedPreferences', available: true })),
  hasPin: jest.fn(async () => 'pin_hash' in secureState),
  setPin: jest.fn(async () => {
    Object.assign(secureState, { pin_hash: 'h', pin_salt: 's' });
    return null;
  }),
  verifyPin: jest.fn(async () => ({ ok: false, locked: false, attempts: 0 })),
  clearPin: jest.fn(async () => {
    Object.keys(secureState).forEach(k => {
      if (k.startsWith('pin_')) delete secureState[k];
    });
    return null;
  }),
  recordPinFailure: jest.fn(async () => ({ attempts: 0, lockedUntil: 0, locked: false })),
  getPinLockout: jest.fn(async () => ({ attempts: 0, lockedUntil: 0, locked: false })),
  resetPinFailures: jest.fn(async () => null),
  clearAll: jest.fn(async () => {
    Object.keys(secureState).forEach(k => delete secureState[k]);
    return null;
  }),
};
NativeModules.BiometricGate = biometric;

const appStateHandlers: ((s: string) => void)[] = [];
(AppState as any).currentState = 'active';
(AppState as any).addEventListener = jest.fn((_t: string, h: (s: string) => void) => {
  appStateHandlers.push(h);
  return { remove: () => {} };
});

const AppLock = require('./AppLock').default;
const policy = require('../../security/appLockPolicy');
const { useAppLock } = require('./AppLock');
const { PaperProvider } = require('react-native-paper');
const { SafeAreaProvider } = require('react-native-safe-area-context');

let liveTree: TestRenderer.ReactTestRenderer | undefined;

const mount = async () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      React.createElement(
        SafeAreaProvider,
        {
          initialMetrics: {
            frame: { x: 0, y: 0, width: 390, height: 844 },
            insets: { top: 0, left: 0, right: 0, bottom: 0 },
          },
        },
        React.createElement(PaperProvider as any, null, React.createElement(AppLock as any)),
      ),
    );
  });
  await act(async () => {});
  liveTree = tree;
  return tree!;
};

const emitAppState = async (state: string) => {
  await act(async () => {
    appStateHandlers.forEach(h => h(state));
  });
  await act(async () => {});
};

/**
 * Advance the clock, flushing React between chunks.
 *
 * Not `jest.advanceTimersByTime(ms)` in one jump. React batches the state
 * updates a timer callback makes and flushes them when `act` returns, so a
 * single big jump runs every timer that was *already* queued before the effects
 * that queue ran get a chance to queue theirs - and a timer scheduled by an
 * effect therefore starts its own countdown from the end of the jump instead of
 * from when it was due. Stepping in small slices reproduces the real ordering.
 */
const advance = async (ms: number) => {
  let left = ms;
  while (left > 0) {
    const step = Math.min(100, left);
    await act(async () => {
      jest.advanceTimersByTime(step);
    });
    await act(async () => {});
    left -= step;
  }
};

/** Every user-visible string in the tree, flattened. */
const text = (tree: TestRenderer.ReactTestRenderer): string => {
  const out: string[] = [];
  const walk = (n: any) => {
    if (n == null) return;
    if (typeof n === 'string') {
      out.push(n);
      return;
    }
    if (Array.isArray(n)) return n.forEach(walk);
    if (n.children) n.children.forEach(walk);
  };
  walk(tree.toJSON());
  return out.join(' | ');
};

const has = (tree: TestRenderer.ReactTestRenderer, needle: string) =>
  text(tree).includes(needle);

const PIN_INPUT = 'app-lock-pin-input';
const hasPinPad = (tree: TestRenderer.ReactTestRenderer) =>
  tree.root.findAll(n => n.props?.testID === PIN_INPUT).length > 0;

const prompts = () => biometric.authenticate.mock.calls.length;

/**
 * ------------------------------------------------------------------------
 * THE WAY-FORWARD INVARIANT
 * ------------------------------------------------------------------------
 *
 * A gate that is up must be offering one of exactly three things. Every branch
 * in the suite below is a way the store or the device can misbehave; each one
 * still has to leave the user able to act. This is the only place that is
 * asserted, so that adding a new failure mode cannot quietly add a fourth
 * answer.
 */
const expectAWayOut = (tree: TestRenderer.ReactTestRenderer) => {
  const promptWasRaised = prompts() > 0;
  expect(
    promptWasRaised || hasPinPad(tree) || has(tree, 'Forgot your PIN?') || has(tree, 'Sign out and reset'),
  ).toBe(true);
};

const reset = () => {
  Object.keys(secureState).forEach(k => delete secureState[k]);
  getItemImpl = async k => (k in secureState ? secureState[k] : null);
  mockIncoming.current = null;
  NativeModules.SecureStore.hasPin.mockReset();
  NativeModules.SecureStore.hasPin.mockImplementation(async () => 'pin_hash' in secureState);
  biometric.authenticate.mockReset();
  biometric.authenticate.mockImplementation(async () => ({ status: 'cancelled' }));
  biometric.getAvailability.mockReset();
  biometric.getAvailability.mockImplementation(async () => ({
    available: true,
    reason: 'ok',
    status: 0,
    deviceCredentialAvailable: true,
  }));
  biometric.cancel.mockClear();
  appStateHandlers.length = 0;
  (AppState as any).currentState = 'active';
  // The baseline: a healthy install with the lock on and a PIN behind it.
  secureState['applock.enabled'] = 'true';
  secureState['applock.graceMs'] = '30000';
  secureState.pin_hash = 'h';
  useAppLock.setState({
    status: 'unknown',
    enabled: false,
    pinSet: false,
    gateActive: false,
    availability: null,
    backend: null,
    busy: false,
    error: null,
  });
  policy.noteCallHandOff();
  policy.claimCallHandOff();
};

beforeEach(async () => {
  jest.useFakeTimers();
  await AsyncStorage.clear();
  reset();
});

afterEach(async () => {
  jest.useRealTimers();
  if (liveTree) {
    const tree = liveTree;
    liveTree = undefined;
    await act(async () => {
      tree.unmount();
    });
  }
});

describe('opening the app with the lock on', () => {
  it('raises the OS prompt by itself, with no button pressed', async () => {
    await mount();
    expect(prompts()).toBe(0);

    await advance(400);

    expect(prompts()).toBe(1);
  });

  it('raises exactly one prompt for one episode', async () => {
    await mount();
    await advance(5_000);

    expect(prompts()).toBe(1);
  });

  it('still raises one after the gate has already been armed once', async () => {
    // The bug this guards is an episode bump that React never sees, so the
    // auto-prompt effect cannot re-run and episode 2 never prompts.
    secureState['applock.graceMs'] = '0';
    await mount();
    await advance(1_000);
    expect(prompts()).toBe(1);

    biometric.authenticate.mockImplementation(async () => ({ status: 'error' }));
    await emitAppState('background');
    await advance(1);
    await emitAppState('active');
    await advance(1_000);

    expect(prompts()).toBe(2);
  });

  it('still prompts, eventually, if a blanket foreground stamp is left in place', async () => {
    // App.tsx's FCM AppState listener stamped on every 'active'. This is the
    // promise the gate makes even if that line is never removed: a stamp with no
    // call behind it delays the prompt by the call-born grace and no more. It
    // must not suppress it.
    policy.noteCallHandOff();
    await mount();
    await advance(400);
    // Deferred, not lost.
    expect(prompts()).toBe(0);

    await advance(4_000);

    expect(prompts()).toBe(1);
  });

  it('does not re-present after the user dismissed the prompt', async () => {
    biometric.authenticate.mockImplementation(async () => ({ status: 'cancelled' }));
    await mount();
    await advance(1_000);

    expect(prompts()).toBe(1);
    expect(hasPinPad(liveTree!)).toBe(true);
  });
});

describe('the gate can never come up with no way forward', () => {
  it('a healthy install shows the prompt', async () => {
    const tree = await mount();
    await advance(400);
    expectAWayOut(tree);
  });

  it('after a dismissed prompt, the PIN pad is there', async () => {
    const tree = await mount();
    await advance(1_000);
    expectAWayOut(tree);
    expect(hasPinPad(tree)).toBe(true);
  });

  it('no biometric enrolled: PIN pad, no prompt, still escapable', async () => {
    biometric.getAvailability.mockImplementation(async () => ({
      available: false,
      reason: 'noneEnrolled',
      status: 11,
      deviceCredentialAvailable: true,
    }));
    const tree = await mount();
    await advance(1_000);

    expect(prompts()).toBe(0);
    expectAWayOut(tree);
    expect(hasPinPad(tree)).toBe(true);
  });

  it('an unreadable store fails closed onto the reset control', async () => {
    await AsyncStorage.setItem('synomilo.applock.configured', 'true');
    getItemImpl = async () => {
      throw Object.assign(new Error('keyset unusable'), {
        code: 'E_SECURE_STORE_UNAVAILABLE',
      });
    };
    NativeModules.SecureStore.hasPin.mockImplementation(async () => {
      throw Object.assign(new Error('keyset unusable'), {
        code: 'E_SECURE_STORE_UNAVAILABLE',
      });
    });
    const tree = await mount();
    await advance(1_000);

    expect(useAppLock.getState().status).toBe('storeBroken');
    expect(useAppLock.getState().gateActive).toBe(true);
    expectAWayOut(tree);
  });

  it('a store silently reset under an "on" marker fails closed too', async () => {
    // The fallback backend answers null for everything and throws for nothing.
    await AsyncStorage.setItem('synomilo.applock.configured', 'on');
    getItemImpl = async () => null;
    NativeModules.SecureStore.hasPin.mockImplementation(async () => false);
    const tree = await mount();
    await advance(1_000);

    expect(useAppLock.getState().status).toBe('storeBroken');
    expectAWayOut(tree);
  });

  it('the flag on with no verifier behind it fails closed onto the reset control', async () => {
    NativeModules.SecureStore.hasPin.mockImplementation(async () => false);
    const tree = await mount();
    await advance(1_000);

    expect(useAppLock.getState().status).toBe('storeBroken');
    expectAWayOut(tree);
    expect(has(tree, 'Sign out and reset')).toBe(true);
  });

  it('an OS lockout leaves the PIN pad, not a dead screen', async () => {
    biometric.authenticate.mockImplementation(async () => ({ status: 'lockout' }));
    const tree = await mount();
    await advance(1_000);

    expect(prompts()).toBe(1);
    expectAWayOut(tree);
    expect(hasPinPad(tree)).toBe(true);
  });

  it('a prompt the OS refused to host leaves the PIN pad', async () => {
    biometric.authenticate.mockImplementation(async () => ({
      status: 'unavailable',
      reason: 'unknown',
      message: 'E_ACTIVITY_NOT_RESUMED',
    }));
    const tree = await mount();
    await advance(1_000);

    expectAWayOut(tree);
    expect(hasPinPad(tree)).toBe(true);
    expect(has(tree, 'Enter your PIN to continue.')).toBe(true);
  });

  it('a prompt the user dismisses by backgrounding still leaves the PIN pad', async () => {
    // The OS backgrounds us on the way to the device-credential fallback, and the
    // native promise may never settle. `prompting` must not stay set.
    let settle: ((v: { status: string }) => void) | undefined;
    biometric.authenticate.mockImplementation(
      () =>
        new Promise<{ status: string }>(resolve => {
          settle = resolve;
        }),
    );
    const tree = await mount();
    await advance(400);
    expect(prompts()).toBe(1);

    await emitAppState('background');
    await advance(1);

    expectAWayOut(tree);
    expect(hasPinPad(tree)).toBe(true);
    settle?.({ status: 'cancelled' });
  });

  it('a cold start that is not yet resumed eventually prompts anyway', async () => {
    (AppState as any).currentState = 'background';
    await mount();
    await advance(1_000);
    expect(prompts()).toBe(0);

    await emitAppState('active');
    await advance(1_000);

    expect(prompts()).toBe(1);
  });
});

describe('accepting a call', () => {
  it('does not re-prompt on a cold start launched by the accept', async () => {
    // What App.tsx does before `navigate('CallScreen')`.
    policy.noteCallHandOff();
    const tree = await mount();
    await advance(1_000);

    expect(prompts()).toBe(0);
    expectAWayOut(tree);
  });

  it('withholds the prompt only for the navigation gap, then asks anyway', async () => {
    // The safety net. If the accept never lands on a call screen, the exemption
    // must not outlive the gap.
    policy.noteCallHandOff();
    await mount();
    await advance(1_000);
    expect(prompts()).toBe(0);

    await advance(3_000);

    expect(prompts()).toBe(1);
  });

  it('a hand-off cannot suppress two episodes', async () => {
    secureState['applock.graceMs'] = '0';
    policy.noteCallHandOff();
    await mount();
    await advance(4_000);
    expect(prompts()).toBe(1);

    // A second, ordinary re-lock: no new hand-off was noted.
    biometric.authenticate.mockImplementation(async () => ({ status: 'cancelled' }));
    await emitAppState('background');
    await advance(1);
    await emitAppState('active');
    await advance(1_000);

    expect(prompts()).toBe(2);
  });

  it('a resume that is a ringing call neither re-arms nor hands over', async () => {
    secureState['applock.graceMs'] = '0';
    await mount();
    await advance(1_000);
    expect(prompts()).toBe(1);

    // `api.calls.incoming` answering is what `ringing` is read from. A ringing
    // call is not an answered one: the gate stays up and no second prompt fires,
    // but nothing is handed to the caller either.
    mockIncoming.current = { _id: 'call1' };
    await emitAppState('background');
    await advance(1);
    await emitAppState('active');
    await advance(1_000);

    expect(prompts()).toBe(1);
    expect(useAppLock.getState().gateActive).toBe(true);

    // Once it is answered, the gate stands down. This is "accepting a call must
    // not re-prompt", stated from the other end.
    const { useCallStore } = require('../calls/callStore');
    await act(async () => {
      useCallStore.setState({ screenVisible: true });
    });
    await advance(0);

    expect(useAppLock.getState().gateActive).toBe(false);

    await act(async () => {
      useCallStore.setState({ screenVisible: false });
      mockIncoming.current = null;
    });
  });
});

describe('the lock row and the gate read the same answer', () => {
  const { summarizeLockState } = policy;

  it('agrees with the gate on a healthy install', async () => {
    await mount();
    await advance(400);
    const s = useAppLock.getState();

    expect(
      summarizeLockState({
        status: s.status,
        enabled: s.enabled,
        pinSet: s.pinSet,
        biometricsAvailable: s.availability?.available === true,
      }),
    ).toEqual({ willLock: true, needsReset: false, label: 'On, biometrics with a PIN fallback' });
  });

  it('never claims a PIN fallback on an install that has none', async () => {
    NativeModules.SecureStore.hasPin.mockImplementation(async () => false);
    await mount();
    await advance(1_000);
    const s = useAppLock.getState();

    const summary = summarizeLockState({
      status: s.status,
      enabled: s.enabled,
      pinSet: s.pinSet,
      biometricsAvailable: s.availability?.available === true,
    });

    expect(summary.label).not.toMatch(/PIN fallback/);
    expect(summary.willLock).toBe(true);
    expect(summary.needsReset).toBe(true);
  });

  it('says "off" only when the gate really is off', async () => {
    // A fresh install: no marker, nothing in the store. Nothing locks, and the
    // row says off, which is the truth rather than a convenience.
    delete secureState['applock.enabled'];
    delete secureState['applock.graceMs'];
    delete secureState.pin_hash;
    const tree = await mount();
    await advance(1_000);
    const s = useAppLock.getState();

    expect(s.status).toBe('ready');
    expect(s.enabled).toBe(false);
    expect(s.gateActive).toBe(false);
    expect(text(tree)).toBe('');
    expect(
      summarizeLockState({
        status: s.status,
        enabled: s.enabled,
        pinSet: s.pinSet,
        biometricsAvailable: s.availability?.available === true,
      }),
    ).toEqual({ willLock: false, needsReset: false, label: 'Off' });
  });

  it('does not say "not available" for a device that does have a store', async () => {
    await mount();
    await advance(1_000);
    const s = useAppLock.getState();
    expect(s.status).toBe('ready');
    expect(
      summarizeLockState({
        status: s.status,
        enabled: s.enabled,
        pinSet: s.pinSet,
        biometricsAvailable: true,
      }).label,
    ).not.toMatch(/Not available/);
  });
});
