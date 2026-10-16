import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Alert,
  Animated,
  AppState,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import type { AppStateStatus } from 'react-native';
import MaterialDesignIcons from '@react-native-vector-icons/material-design-icons';
import { ActivityIndicator, Button, Text, useTheme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from 'convex/react';
import { create } from 'zustand';
import { api } from '../../../convex/_generated/api';
import { useSession } from '../../auth/SessionProvider';
import { useIsKeyboardVisible } from '../../hooks/useIsKeyboardVisible';
import { useCallStore } from '../calls/callStore';
import { APP_NAME } from '../../utils/AppConstants';
import {
  BIOMETRIC_RETRY_COOLDOWN_MS,
  authenticateWithBiometrics,
  cancelBiometricPrompt,
  describeBiometricFailure,
  getBiometricAvailability,
} from '../../security/biometric';
import type { BiometricAvailability } from '../../security/biometric';
import {
  CALL_BORN_PROMPT_GRACE_MS,
  callBornMayWithholdPrompt,
  callInterruptsLock,
  callReleasesGate,
  claimCallHandOff,
  mayPresentPrompt,
  resolveGateSurface,
} from '../../security/appLockPolicy';
import type { CallSignal, GateSurface } from '../../security/appLockPolicy';
import {
  APP_LOCK_GRACE_OPTIONS,
  DEFAULT_LOCK_GRACE_MS,
  PIN_MAX_LENGTH,
  PIN_MIN_LENGTH,
  SecureStoreUnavailableError,
  changePin,
  clearAll,
  clearPin,
  disableAppLock,
  enableAppLock,
  hasPin,
  isSecureStoreSupported,
  isValidPinFormat,
  readAppLockMarker,
  readLockConfig,
  secureBackendInfo,
  secureGetAllKeys,
  verifyPin,
  wasAppLockEverConfigured,
  writeLockConfig,
} from '../../security/secureStore';

/**
 * ------------------------------------------------------------------------
 * THE APP LOCK
 * ------------------------------------------------------------------------
 *
 * One step, usually zero: the OS prompt is presented for you, and the PIN pad
 * is what is left when it cannot be.
 *
 * There is no "Unlock" button in front of the fingerprint prompt. There never
 * should be - the prompt IS the button, and putting a second one in front of it
 * is the two-tap unlock this screen used to have.
 *
 * Nothing biometric is ever captured, hashed or stored here or anywhere else. The
 * OS returns a verified/not-verified result and nothing else, so the only secret
 * this feature owns is the app PIN, and that exists only as a salted PBKDF2
 * verifier inside the encrypted store (see src/security/secureStore.ts). The
 * fingerprint is a *gate* the OS holds; the PIN is the *key* this app holds.
 *
 * Five rules the rest of this file exists to keep:
 *
 *   1. NEVER render what the user is typing, and never render a length indicator.
 *      The field is `secureTextEntry` and there are deliberately no per-character
 *      dots to count. A dot row is a progress bar for an attacker shoulder-
 *      watching the unlock, which is the one threat this screen exists for.
 *
 *   2. NEVER turn an unreadable secure store into "lock off". `readLockConfig`
 *      and `hasPin` throw `SecureStoreUnavailableError` rather than returning a
 *      benign-looking empty, and that lands on `storeBroken`, which offers only
 *      the reset path.
 *
 *   3. NEVER make the reset path conditional on the thing that is broken. A
 *      wrong PIN must not be able to brick an install, so the reset signs out -
 *      which works through AsyncStorage/Convex and has nothing to do with the
 *      keystore - and only then tries to wipe the lock.
 *
 *   4. AT MOST ONE PROMPT PER LOCK EPISODE. Not "one at a time", one ever. The
 *      OS prompt can send this app to the background on its way to showing the
 *      device-credential fallback, and the return trip must not read as a fresh
 *      excursion. See `promptCausedBackground` and `mayPresentPrompt`.
 *
 *   5. NEVER stand between the user and a call. Not over a ringing one, not
 *      over the moment they answer it, not over a live one. See `callSignal`.
 */

// ---------------------------------------------------------------- config store

type LockStatus =
  /** No encrypted store on this platform (iOS, or Jest). No app lock exists. */
  | 'unsupported'
  /** Never read yet. */
  | 'unknown'
  /** Config read successfully. */
  | 'ready'
  /** The store is present but unreadable - a damaged install, not a lock-off. */
  | 'storeBroken';

type LockState = {
  status: LockStatus;
  enabled: boolean;
  graceMs: number;
  pinSet: boolean;
  availability: BiometricAvailability | null;
  backend: string | null;
  busy: boolean;
  error: string | null;
  /**
   * True while the gate is actually covering the app.
   *
   * Mirrors `AppLock`'s local `locked` into the store purely so it can be observed
   * from outside. It exists because `accessibilityViewIsModal` confines VoiceOver
   * on iOS but is a no-op on Android - hiding the app tree from TalkBack is the
   * only way to stop a screen-reader user swiping through to the conversation
   * behind the overlay, and that requires the navigator's own `importantForAccessibility`,
   * which lives in App.tsx. See `useIsAppLockActive`.
   */
  gateActive: boolean;
  refresh: () => Promise<void>;
  setAvailability: (next: BiometricAvailability | null) => void;
  setGateActive: (next: boolean) => void;
  enable: (pin: string) => Promise<boolean>;
  changePin: (pin: string) => Promise<boolean>;
  disable: () => Promise<boolean>;
  setGrace: (ms: number) => Promise<boolean>;
};

/**
 * Settings and the gate share one store.
 *
 * Two independent readers of the encrypted store would race: Settings writes the
 * flag, the gate is deciding whether to render. One store means one answer.
 * `AppLockConfig` is exported as `useAppLock` for Settings to read.
 */
export const useAppLock = create<LockState>((set, get) => ({
  status: 'unknown',
  enabled: false,
  graceMs: DEFAULT_LOCK_GRACE_MS,
  pinSet: false,
  availability: null,
  backend: null,
  busy: false,
  error: null,
  gateActive: false,

  setAvailability: next => set({ availability: next }),

  setGateActive: next => set({ gateActive: next }),

  refresh: async () => {
    if (!isSecureStoreSupported()) {
      set({ status: 'unsupported', enabled: false, pinSet: false });
      return;
    }
    try {
      // `enabled` first. If this throws we must not have looked at `pinSet`
      // yet, because a store that cannot be read may still hold a verifier.
      const config = await readLockConfig();
      const pinSet = await hasPin();
      /**
       * Which protection is live, read back rather than asserted. Settings shows
       * it, because "encrypted at rest" is a claim and this is the value that
       * makes it checkable instead of assumed.
       */
      let backend: string | null = null;
      try {
        backend = (await secureBackendInfo()).backend;
      } catch {
        backend = null;
      }
      /**
       * ------------------------------------------------------------------------
       * THE TWO WAYS A SUCCESSFUL READ CAN STILL BE LYING
       * ------------------------------------------------------------------------
       * `readLockConfig()` returning `enabled: false` is only meaningful if the
       * store it read is the store the user set the lock in. Two cases where it
       * is not, both of which used to end with the gate silently not existing:
       *
       * 1. THE STORE WAS RESET. `SecureStoreModule` opens a fallback backend
       *    when the primary one fails, and that fallback reads a *different*
       *    preferences file under a *different* key. Every read then answers
       *    `null` and nothing throws. `SecureStoreModule.kt:openBackend`.
       *
       * 2. THE FLAG SURVIVED AND THE VERIFIER DID NOT. `applock.enabled` says
       *    on, `hasPin()` says no. The gate comes up with nothing to unlock with.
       *
       * Both are decided here, once, so that the Settings row and the gate are
       * reading the same answer rather than each drawing their own conclusion
       * from the same raw reads. `storeBroken` is also what Settings already
       * renders as "reset required", so this is a description the row can
       * actually show - see `lockDescription` in SettingsScreen.
       */
      const marker = await readAppLockMarker();
      let emptyStore = false;
      try {
        emptyStore = (await secureGetAllKeys()).length === 0;
      } catch {
        emptyStore = false;
      }
      const lostToAReset = marker === 'on' && emptyStore;
      const flagWithoutVerifier = config.enabled && !pinSet;

      if (lostToAReset || flagWithoutVerifier) {
        set({
          status: 'storeBroken',
          enabled: true,
          pinSet: false,
          graceMs: config.graceMs,
          backend,
          error: null,
        });
        console.warn(
          lostToAReset
            ? '[applock] the secure store answered, but it is empty and the lock ' +
                'was recorded as on - treating it as lost and failing closed'
            : '[applock] the lock flag is on with no PIN verifier behind it - ' +
                'treating the configuration as damaged and failing closed',
        );
        return;
      }

      set({
        status: 'ready',
        enabled: config.enabled,
        graceMs: config.graceMs,
        pinSet,
        backend,
        error: null,
      });
    } catch {
      /**
       * An unreadable store is locked-by-default: absence of knowledge is not
       * absence of a lock, and a broken keystore must never silently drop a gate
       * somebody is relying on.
       *
       * EXCEPT on an install where the lock was never enabled. Gating there
       * bricks the app - a recovery-only screen with no lock to recover from -
       * and the store may be unreadable for an innocent reason (no device lock
       * screen set, an OEM Keystore quirk, a restored /data partition). The
       * plaintext marker in `wasAppLockEverConfigured()` exists precisely to tell
       * those two cases apart.
       */
      const everConfigured = await wasAppLockEverConfigured();
      set({
        status: everConfigured ? 'storeBroken' : 'ready',
        enabled: everConfigured,
        // A fresh install that cannot read its store has no lock to honour.
        pinSet: false,
        graceMs: DEFAULT_LOCK_GRACE_MS,
        backend: null,
        error: null,
      });
      if (!everConfigured) {
        console.warn(
          '[applock] secure store unavailable on an install with no configured ' +
            'lock - app lock stays off rather than bricking the app',
        );
      }
    }
  },

  enable: async pin => {
    if (!isValidPinFormat(pin)) {
      set({ error: `Choose a ${PIN_MIN_LENGTH} to ${PIN_MAX_LENGTH} digit PIN.` });
      return false;
    }
    set({ busy: true, error: null });
    try {
      await enableAppLock(pin, get().graceMs);
      await get().refresh();
      set({ busy: false });
      return true;
    } catch (error) {
      set({
        busy: false,
        error:
          error instanceof SecureStoreUnavailableError
            ? 'This device can no longer read its secure storage.'
            : 'Could not turn on the app lock.',
      });
      return false;
    }
  },

  changePin: async pin => {
    if (!isValidPinFormat(pin)) {
      set({ error: `Choose a ${PIN_MIN_LENGTH} to ${PIN_MAX_LENGTH} digit PIN.` });
      return false;
    }
    set({ busy: true, error: null });
    try {
      await changePin(pin);
      await get().refresh();
      set({ busy: false });
      return true;
    } catch {
      set({ busy: false, error: 'Could not change your PIN.' });
      return false;
    }
  },

  disable: async () => {
    set({ busy: true, error: null });
    try {
      await disableAppLock();
      await get().refresh();
      set({ busy: false });
      return true;
    } catch {
      set({ busy: false, error: 'Could not turn off the app lock.' });
      return false;
    }
  },

  setGrace: async ms => {
    const graceMs =
      APP_LOCK_GRACE_OPTIONS.find(option => option.ms === ms)?.ms ??
      DEFAULT_LOCK_GRACE_MS;
    const previous = get().graceMs;
    // Optimistic: the picker should not visibly wait on a keystore round trip.
    set({ graceMs });
    try {
      await writeLockConfig({ enabled: get().enabled, graceMs });
      return true;
    } catch {
      set({ graceMs: previous });
      return false;
    }
  },
}));

// ---------------------------------------------------------------- reduced motion

/**
 * Whether the user has asked the system to reduce motion.
 *
 * The only animated thing here is the shake on a wrong PIN, and it is exactly the
 * kind of movement that triggers vestibular symptoms. When motion is reduced the
 * shake is replaced by the error text alone - the information is identical, only
 * the movement is gone.
 */
function useReduceMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then(value => {
        if (!cancelled) {
          setReduced(value);
        }
      })
      .catch(() => {});
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      value => setReduced(value),
    );
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  return reduced;
}

// ---------------------------------------------------------------- PIN field

type PinFieldProps = {
  label: string;
  value: string;
  onChange: (next: string) => void;
  onSubmit?: () => void;
  autoFocus?: boolean;
  disabled?: boolean;
  placeholder?: string;
};

/**
 * The PIN input.
 *
 * Secure entry, number pad, autofill and clipboard suggestions off. Nothing is
 * drawn per character: no dots, no counters, no `•••` placeholder - so there is
 * nothing on this screen whose width or fill level changes as a PIN is typed.
 *
 * `accessibilityRole` is deliberately absent here and only here. React Native's
 * `AccessibilityRole` has no text-field member (the 0.81.4 Android enum is NONE,
 * BUTTON, ..., WEBVIEW - no textbox), so any value passed would be a role the node
 * does not have. Leaving it unset keeps the native `EditText` role, which TalkBack
 * announces as "edit box" and VoiceOver as "text field" - strictly better than
 * overriding it with `text`, which would downgrade the node on iOS and web.
 */
const PinField: React.FC<PinFieldProps> = ({
  label,
  value,
  onChange,
  onSubmit,
  autoFocus = false,
  disabled = false,
  placeholder = '••••',
}) => {
  const { colors } = useTheme();

  // `onChangeText` hands us the plain string, not an event.
  const handleChangeText = (text: string) => {
    // Strip anything that is not an ASCII digit *before* it reaches state, so the
    // value can never contain a character the native format check would reject.
    onChange(text.replace(/[^0-9]/g, '').slice(0, PIN_MAX_LENGTH));
  };

  const handleSubmitEditing = () => {
    if (!disabled) {
      onSubmit?.();
    }
  };

  return (
    <TextInput
      style={[
        styles.input,
        {
          color: colors.onSurface,
          backgroundColor: colors.surface,
          borderColor: colors.outlineVariant,
        },
        disabled && {
          color: colors.onSurfaceDisabled,
          borderColor: colors.outlineVariant,
        },
      ]}
      value={value}
      onChangeText={handleChangeText}
      onSubmitEditing={handleSubmitEditing}
      // The underline Android draws on a focused field is the one piece of chrome
      // that would tell an onlooker something; the field carries its own border
      // instead. A prop, not a style - `underlineColorAndroid` is not a TextStyle.
      underlineColorAndroid="transparent"
      editable={!disabled}
      autoFocus={autoFocus}
      secureTextEntry
      keyboardType="number-pad"
      // Returning never helps on a number pad, and the platform's own "return"
      // key invites the user to think submitting is different from tapping Unlock.
      returnKeyType="done"
      blurOnSubmit={false}
      maxLength={PIN_MAX_LENGTH}
      placeholder={placeholder}
      placeholderTextColor={colors.outline}
      // The PIN must never reach a keyboard-learning dictionary, an autofill
      // sheet, or a paste buffer. `oneTimeCode` would be actively wrong here: it
      // invites the OS to offer an SMS code into this very field.
      textContentType="none"
      autoComplete="off"
      autoCorrect={false}
      spellCheck={false}
      importantForAutofill="no"
      accessibilityLabel={label}
      accessibilityHint={`Enter between ${PIN_MIN_LENGTH} and ${PIN_MAX_LENGTH} digits. The PIN is never shown as you type.`}
      accessibilityState={{ disabled }}
      testID="app-lock-pin-input"
    />
  );
};

// ---------------------------------------------------------------- lock screen

/**
 * How loudly a line of status text is drawn. There is no third state on purpose:
 * this screen is monochrome, so severity is expressed with contrast and position,
 * never with a colour that would carry meaning the palette cannot hold.
 */
type StatusTone = 'info' | 'error';

const formatCountdown = (ms: number): string => {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
};

/**
 * How long after arming the automatic prompt is presented, in milliseconds.
 *
 * One short beat, not a spinner and not a "get ready" step. Android reports the
 * host activity resumed a moment before it will actually host a dialog, and a
 * prompt raised in the same tick loses that race often enough to matter - the
 * native module answers with `E_ACTIVITY_NOT_RESUMED` and the user is dropped
 * onto the PIN pad with no fingerprint prompt ever shown.
 *
 * The gate is already up and already opaque for the whole of this window, so
 * nothing is exposed while it runs, and nothing is added to the number of taps
 * the user has to make: the prompt appears either way, just not instantly.
 */
const AUTO_PROMPT_SETTLE_MS = 400;

/**
 * The one sentence per surface, keyed by the surface itself.
 *
 * A record rather than nested ternaries because the mapping has to be total: if
 * `GateSurface` grows a value and this does not, TypeScript says so, where a
 * chain of `? :` would silently fall through to a stale default.
 */
const SURFACE_SUBTITLE: Record<GateSurface, string> = {
  prompt: 'Waiting for your fingerprint…',
  pinPad: 'Enter your PIN to continue.',
  recovery: 'This device cannot verify who you are. Sign out to get back in.',
};

const AppLock: React.FC = () => {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const keyboardVisible = useIsKeyboardVisible();
  const reduceMotion = useReduceMotion();
  const { token, signOut } = useSession();

  const status = useAppLock(s => s.status);
  const enabled = useAppLock(s => s.enabled);
  const pinSet = useAppLock(s => s.pinSet);
  const availability = useAppLock(s => s.availability);
  const refresh = useAppLock(s => s.refresh);
  const setAvailability = useAppLock(s => s.setAvailability);
  const setGateActive = useAppLock(s => s.setGateActive);
  /**
   * `graceMs` is deliberately NOT subscribed here. The re-lock path reads it from
   * `useAppLock.getState()` inside the `AppState` listener, because that callback
   * is registered once and must not close over a value that Settings can change
   * while the app is backgrounded.
   */

  /** Config has been read at least once. Until then, render an opaque splash. */
  const [resolved, setResolved] = useState(false);
  const [locked, setLocked] = useState(false);
  /**
   * Set by the reset path. Once the user has signed out there is nothing left to
   * protect, and a permanently broken secure store must not be able to re-assert
   * a lock over a session that does not exist.
   */
  const [recovered, setRecovered] = useState(false);

  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  /**
   * A prompt has actually been raised and is awaiting its result, as opposed to
   * being one settle-tick away. Drives the way-forward decision and the one line
   * of text on the screen and nothing else - the prompt is a system window, so
   * there is no progress to draw and nothing here should pretend there is.
   */
  const [prompting, setPrompting] = useState(false);
  const [message, setMessage] = useState<{ tone: StatusTone; text: string } | null>(null);
  const [lockedUntil, setLockedUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  /**
   * Why this screen cannot simply ask `biometricAvailable`.
   *
   * It used to, twice, with two different expressions, and the space between
   * them is where "the gate came up and offered nothing" lived.
   */
  const backgroundedAt = useRef<number | null>(null);
/**
 * Monotonic id of the current lock episode. Bumped by `armLock` and by nothing
 * else, which is what makes "one prompt per episode" a fact about the state
 * rather than a promise about the call sites. This is the synchronous authority:
 * decisions are taken before React has flushed, and `episode` below exists only
 * to make those decisions cause a re-render.
 */
const episodeRef = useRef(0);
const [episode, setEpisode] = useState(0);
/**
 * The episode whose prompt has already been presented, or -1.
 *
 * A separate value rather than a boolean on `episode`, because re-arming has to
 * leave the record of what has already happened intact. A boolean has to be
 * cleared to re-arm, and clearing it is the instant a second prompt becomes
 * reachable. Ref only, deliberately: every site that claims also calls
 * `setMessage` or `setPrompting`, so the render already happens, and mirroring
 * this into state would be a second writer for a value whose only readers are
 * synchronous decisions that cannot wait for React.
 */
const presentedRef = useRef(-1);
/**
 * The episode that was armed inside a call hand-off, and when, or null.
 *
 * Set once per arming from `claimCallHandOff`, which is itself one-shot per
 * `openCallScreen`. A call-born episode owes no prompt - the call is taking the
 * screen - but only until `callBornMayWithholdPrompt` says the grace is over.
 * After that it is an ordinary episode and owes one like anything else, which is
 * what makes "the call never arrived" a survivable outcome rather than a locked
 * phone.
 *
 * State, not a ref, and that is the whole point of it. Expiring the grace means
 * telling React that something changed, and the only way to do that is to change
 * some state. The first version of this was two refs plus
 * `setEpisode(episodeRef.current)` in the expiry timer - which sets state to the
 * value it already holds, so React bailed out, nothing re-rendered, the effect
 * never re-ran, and the exemption silently outlived its own deadline. The same
 * trap as the ref-only episode id, reached from the opposite direction.
 */
const [callBorn, setCallBorn] = useState<{ episode: number; at: number } | null>(null);
const promptInFlight = useRef(false);
/**
 * Set when the app went to the background while our own prompt was up, which
 * the OS does routinely on the way to showing the device-credential fallback.
 * That excursion is not the user leaving, so returning from it must not re-arm
 * and must not present again. Without this the prompt cancels itself and a
 * second one arrives on the way back in - the reported double prompt.
 */
const promptCausedBackground = useRef(false);
/**
 * Set when *we* tore the prompt down (backgrounded, or released the gate for a
 * call). A dismissal the app caused is not a failure to report to the user as
 * though they had done something wrong.
 */
const suppressFailureCopy = useRef(false);
/** Wall-clock ms until which Android's own lockout backoff is still running. */
const lockoutUntil = useRef(0);
/**
 * `AppState.currentState === 'active'`, as state.
 *
 * Also state for the same reason `episode` is: this was a ref, so the moment
 * `AppState` reported `'active'` the auto-prompt effect had no way to learn
 * about it. On a cold start where `currentState` is not yet `'active'` when
 * this module initialises, `mayPresentPrompt` refused, no timer was scheduled,
 * and nothing ever re-ran the effect - the fingerprint prompt was suppressed
 * for the whole episode, and for the rest of the process, with no way back.
 *
 * The initial value is unchanged and correct. What changed is that a later
 * `'active'` is now visible to the effect instead of vanishing into a ref.
 */
const [appActive, setAppActive] = useState(AppState.currentState === 'active');
const appActiveRef = useRef(AppState.currentState === 'active');
const callSignal = useRef<CallSignal>({
  connected: false,
  ringing: false,
  callScreenVisible: false,
});
const shake = useRef(new Animated.Value(0)).current;

const biometricAvailable = availability?.available === true;
const storeBroken = status === 'storeBroken';
const unsupported = status === 'unsupported';

  /**
   * Whether the PIN can be offered at all.
   *
   * `pinSet` is only meaningful when the store could actually be read. On a
   * `storeBroken` install `hasPin()` threw, or the configuration was found to be
   * damaged, and neither says anything about whether a usable verifier exists -
   * so the field is hidden rather than offered on a guess.
   */
  const pinUsable = pinSet && !storeBroken;

  /**
   * ------------------------------------------------------------------------
   * THE WAY-FORWARD INVARIANT
   * ------------------------------------------------------------------------
   *
   * A gate that is up MUST be offering one of exactly three things: the OS
   * prompt, the PIN pad, or sign-out-and-reset. `resolveGateSurface` is that
   * question, asked once, as a value.
   *
   * The question is NOT `biometricAvailable`. That is a property of the device,
   * not of this episode, and using it is wrong in both directions: a device
   * with a working sensor whose episode has already spent its prompt showed
   * neither a PIN pad nor a reset, and a device without one hid the PIN pad
   * behind a state that also happened to cover the broken-store case.
   *
   * There is no fourth combination. `promptShowing` is the OS dialog actually
   * being up; when it is false the PIN pad is the floor; and when there is no
   * usable verifier the reset control is unconditional anyway, so `recovery` is
   * reached only to give it something to say.
   */
const promptShowing = prompting;
  const surface = resolveGateSurface({ promptShowing, pinUsable });
  const showPinField = surface === 'pinPad';
  const recoveryOnly = surface === 'recovery';

  /**
   * What the lock can see of the call that may be happening right now.
   *
   * `useCallStore.active` alone is not enough, and this is the specific gap that
   * produced "I accept the call and it asks me for my biometric pin": between the
   * Accept press and `WebRTCCallScreen` reporting the call active there is a
   * window measured in hundreds of milliseconds and a query round trip, and that
   * window is exactly when the resume handler decides to re-lock. `ringing`
   * covers the resume itself and `callScreenVisible` covers a cold start
   * launched by the accept, so between them there is no gap left.
   *
   * All three are false when Convex is unreachable, which lands on the
   * fail-closed side: the lock comes up.
   */
  const connectedCall = useCallStore(s => s.active !== null);
  const callScreenVisible = useCallStore(s => s.screenVisible);
  const incomingCall = useQuery(api.calls.incoming, token ? { token } : 'skip') as
    | { _id: string }
    | null
    | undefined;
  const ringingCall = incomingCall != null;

  useEffect(() => {
    callSignal.current = { connected: connectedCall, ringing: ringingCall, callScreenVisible };
  }, [connectedCall, ringingCall, callScreenVisible]);

  /**
   * Mirrors the gate's own state for App.tsx's TalkBack isolation - see
   * `useIsAppLockActive`. This is the exact condition under which the component
   * below returns the overlay rather than `null`.
   */
  const gateVisible = resolved && token != null && !unsupported && !recovered && locked;

  useEffect(() => {
    setGateActive(gateVisible);
  }, [gateVisible, setGateActive]);

  /**
   * Starts a fresh lock episode.
   *
   * Every path that decides "locked" goes through here, which is what keeps the
   * episode id, the prompt record and the PIN field in step with the gate. The
   * id moves and the record of what already happened does not: that asymmetry is
   * the whole anti-loop mechanism, so it is stated rather than implied.
   *
   * Three things here are load-bearing and were not, before:
   *
   *   - The episode id is written to STATE as well as to a ref. `armLock` is
   *     called on every resume, including resumes that happen while the gate is
   *     already up (a prompt the user dismissed rather than satisfied), and in
   *     that case `setLocked(true)` is a no-op. With a ref-only episode the whole
   *     arm was invisible to React, nothing re-rendered, and the auto-prompt
   *     effect could not run - so episode 2 and every one after it got no prompt
   *     at all, silently, for the rest of the process.
   *
   *   - The call hand-off is claimed HERE, once, and recorded against this
   *     episode. `openCallScreen` stamps it; `armLock` is the only reader. A
   *     cold start launched by answering a call arms a call-born episode, which
   *     owes no prompt because the call is about to take the screen and the
   *     release effect below will stand the gate down. Nothing else can be
   *     affected by that stamp, which is what it was not before: it used to be
   *     read by `callInterruptsLock` and `callReleasesGate` as well, so a stamp
   *     taken on any ordinary foreground suppressed the prompt on every open.
   *
   *   - The call-born exemption is given a deadline, recorded here alongside the
   *     episode. An arming that claims a hand-off is promising that a call is
   *     about to arrive, and nothing enforces that promise. Without the deadline
   *     an accept that failed to navigate would leave an episode that is exempt
   *     from the only thing every other episode gets. See
   *     `callBornMayWithholdPrompt`.
   *
   * Nothing here reads `availability`. The old code stamped a `promptState`
   * from whatever the store happened to say at arming time, which permanently
   * settled any episode armed before the device had answered, and no later
   * update could undo it. The episode id already encodes "owes a prompt";
   * availability only decides whether the auto-prompt effect can act on it.
   */
  const armLock = useCallback(() => {
    episodeRef.current += 1;
    const current = episodeRef.current;
    setCallBorn(claimCallHandOff() ? { episode: current, at: Date.now() } : null);
    setEpisode(current);
    setLocked(true);
    setPin('');
    setMessage(null);
  }, []);

  /**
   * Brings the gate down without clearing the episode.
   *
   * Used when a call takes precedence. The gate was never satisfied by an unlock
   * here - it was stood down - so the episode stays armed and a later excursion
   * still re-locks. Releasing the gate must not look like unlocking it.
   */
  const releaseGate = useCallback(() => {
    cancelBiometricPrompt();
    promptInFlight.current = false;
    suppressFailureCopy.current = true;
    // The promise the call-born exemption was extended on has now been kept, so
    // the exemption is spent rather than merely expired.
    setCallBorn(null);
    setPrompting(false);
    setLocked(false);
    setPin('');
    setMessage(null);
  }, []);

  // ---------------------------------------------------------------- bootstrap

  useEffect(() => {
    refresh()
      .then(() => getBiometricAvailability())
      .then(found => setAvailability(found))
      .catch(() => {})
      .finally(() => setResolved(true));
  }, [refresh, setAvailability]);

  /**
   * Locks whenever the store says the lock is on.
   *
   * Runs on mount (cold start into a locked app) and whenever Settings turns the
   * lock on - the user should not have to background the app to see their own
   * change take effect. `recovered` is sticky so the reset path is never undone
   * by a later refresh.
   *
   * Re-arming is safe because this effect only re-runs when one of its stable
   * dependencies changes: unlocking sets `locked` directly and does not come back
   * through here.
   */
  useEffect(() => {
    if (!resolved || recovered) {
      return;
    }
    if (status === 'unknown') {
      return;
    }
    // A store that cannot be read is locked-by-default. Not because a lock is
    // known to exist, but because "cannot tell" must never render as "no lock".
    if (status === 'storeBroken') {
      armLock();
      return;
    }
    if (status === 'unsupported' || !enabled) {
      setLocked(false);
      return;
    }
    armLock();
  }, [resolved, recovered, status, enabled, armLock]);

  // ---------------------------------------------------------------- relock

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      /**
       * `background` only, never `inactive`.
       *
       * Android sends `inactive` for a notification-shade pull and for a
       * foreground system dialog - including the biometric prompt on some OEM
       * builds. Re-locking on it would demand a fingerprint immediately after a
       * successful one, which is the "cannot get in" bug this screen must not
       * have. A shade pull also does not send `background`, so the grace period is
       * for real excursions, not for notifications.
       */
      if (next === 'background') {
        backgroundedAt.current = Date.now();
        appActiveRef.current = false;
        setAppActive(false);
        /**
         * The prompt is allowed to background us. Showing the device-credential
         * fallback launches a system activity, which stops ours, and some OEM
         * builds do the same just to raise the fingerprint dialog.
         *
         * So the excursion is recorded as ours *before* the flag is cleared:
         * clearing `promptInFlight` without this mark is precisely how the
         * returning 'active' below reads as a fresh excursion and fires a second
         * prompt over the first. Tearing the prompt down here as well is what
         * keeps the in-flight flag from wedging on a prompt the OS dismissed
         * without ever calling back - a promise that never settles is a lock
         * screen nobody can leave.
         *
         * `setPrompting(false)` is load-bearing alongside the ref clear. `prompting`
         * is what the render reads to decide between the prompt and the PIN pad,
         * and a flag that the OS left set while the dialog is gone is a gate
         * showing "waiting for your fingerprint" with no fingerprint dialog.
         */
        if (promptInFlight.current) {
          promptCausedBackground.current = true;
          suppressFailureCopy.current = true;
          cancelBiometricPrompt();
          promptInFlight.current = false;
          setPrompting(false);
        }
        return;
      }
      if (next !== 'active') {
        return;
      }
      appActiveRef.current = true;
      setAppActive(true);

      const leftAt = backgroundedAt.current;
      backgroundedAt.current = null;
      if (leftAt === null) {
        return;
      }

      /**
       * Returning from the excursion our own prompt caused is not returning from
       * an excursion. The episode stays exactly as it was: still locked, still
       * holding its single spent prompt.
       */
      if (promptCausedBackground.current) {
        promptCausedBackground.current = false;
        return;
      }

      /**
       * Never come back to a lock screen over a call.
       *
       * Two cases, and the second is the reported one. An active call is the
       * long-standing rule. A call that is still *ringing* covers the resume that
       * IS the answer: the user tapped Accept on the native ring activity, this
       * activity is being brought forward to carry the call, and by the time the
       * call screen reports itself active the resume decision has long since been
       * made. Putting a PIN pad there is what the user reported as "it opens the
       * app and asks me for my biometric pin" - a second unlock stacked on one
       * they had just satisfied at the phone's own lock screen.
       *
       * Read-only use of the call store; nothing in it is modified.
       */
      if (callInterruptsLock(callSignal.current)) {
        return;
      }

      const { status: currentStatus, enabled: currentEnabled, graceMs: currentGrace } =
        useAppLock.getState();
      if (currentStatus !== 'ready' || !currentEnabled) {
        return;
      }
      if (Date.now() - leftAt < currentGrace) {
        return;
      }

      armLock();
    });
    return () => subscription.remove();
  }, [armLock]);

  // ---------------------------------------------------------------- countdown

  useEffect(() => {
    if (lockedUntil <= 0) {
      return;
    }
    /**
     * Self-terminating. Without the expiry check the interval would keep ticking
     * for the life of the component after a single cooldown, because the effect
     * only re-runs when `lockedUntil` itself changes.
     */
    const timer = setInterval(() => {
      const at = Date.now();
      setNow(at);
      if (at >= lockedUntil) {
        clearInterval(timer);
        setLockedUntil(0);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [lockedUntil]);

  const cooldownRemaining = Math.max(0, lockedUntil - now);

  // ---------------------------------------------------------------- unlock

  /**
   * Presents the OS prompt, or does not - exactly once per lock episode.
   *
   * The claim is made *synchronously*, before the first `await`, which is the
   * only place it can be made. Everything after this line can yield to the event
   * loop, and anything that yields is a window in which a second caller - a
   * re-render, the auto-prompt effect re-running, an `AppState` bounce - could
   * otherwise get in.
   *
   * The episode is read from `episodeRef`, not from `episode`. This callback is
   * memoised on `biometricAvailable` alone, so a captured `episode` is whatever
   * the render that created it saw - which after the first `armLock` is episode
   * 1 forever, and would claim episode 1 for every later arm.
   */
  const runBiometric = useCallback(async () => {
    if (!biometricAvailable || promptInFlight.current) {
      return;
    }
    if (lockoutUntil.current > Date.now()) {
      return;
    }
    const current = episodeRef.current;
    /**
     * Belt to the braces in the auto-prompt effect below. `runBiometric` returns
     * before claiming the episode, so a call arriving inside the settle window
     * costs this episode its prompt rather than nothing at all - which is the
     * honest reading: the prompt was offered and the call took the moment. The
     * PIN pad is the floor, so nothing is lost by not presenting.
     */
    if (callInterruptsLock(callSignal.current)) {
      presentedRef.current = current;
      return;
    }
    presentedRef.current = current;
    promptInFlight.current = true;
    suppressFailureCopy.current = false;
    setBusy(true);
    setPrompting(true);
    try {
      const result = await authenticateWithBiometrics({
        title: `Unlock ${APP_NAME}`,
        subtitle: 'Confirm it is you',
      });
      if (result.status === 'success') {
        setLocked(false);
        setMessage(null);
        setPin('');
        return;
      }
      /**
       * Android's own backoff, honoured so the next episode does not open a
       * prompt that can only fail. `BIOMETRIC_RETRY_COOLDOWN_MS` is the OS's own
       * 30 seconds, not a number this app picked.
       */
      if (result.status === 'lockout') {
        lockoutUntil.current = Date.now() + BIOMETRIC_RETRY_COOLDOWN_MS;
      }
      if (suppressFailureCopy.current) {
        return;
      }
      /**
       * Anything else - a cancel, a lockout, a dismissal, a prompt the OS
       * refused to host - is left to the render, which puts the PIN pad up the
       * moment `prompting` goes false. Nothing has to set a flag here: the pad is
       * the floor for "no prompt is up", and it is reachable with no second tap,
       * which is what makes this one step rather than the two-step unlock this
       * flow used to have.
       *
       * `pinSet` is read from the store rather than closed over. The callback is
       * memoised on `biometricAvailable` alone, so a captured `pinSet` is the
       * value from whichever render happened to create it - and the copy would
       * then promise a PIN pad for an install that has none.
       */
      setMessage(
        describeBiometricFailure(result, { pinAvailable: useAppLock.getState().pinSet }),
      );
    } finally {
      promptInFlight.current = false;
      setBusy(false);
      setPrompting(false);
    }
  }, [biometricAvailable]);

  /**
   * Auto-trigger. No button, no waiting for the user to ask.
   *
   * Four things have to be true before this presents anything, and each one used
   * to be a bug:
   *
   *   1. There is an enrolled strong biometric. Otherwise the PIN pad is the
   *      screen, and this effect does nothing at all.
   *   2. The app is in the foreground. The native module needs a RESUMED
   *      `FragmentActivity` and rejects anything else; asking too early used to
   *      produce "the screen changed before the fingerprint check could open" on
   *      a cold start, which is the first half of the two-step unlock.
   *   3. The episode has not spent its prompt yet. See `mayPresentPrompt`.
   *   4. This episode is not a call-born one still inside its grace. See
   *      `callBornMayWithholdPrompt`.
   *
   * No call is ringing, being answered or live either. A fingerprint dialog on
   * top of the ring the user is in the middle of answering is the second
   * complaint: "I accept it and it asks me for my biometric pin." When a call is
   * present the episode is marked as having spent its prompt, which puts the PIN
   * pad up - never a dialog over a call.
   *
   * The delay below is the same idea as (2), one beat later. Android reports the
   * activity resumed slightly before it is genuinely ready to host a dialog, so
   * a prompt raised in the same tick as the resume is a coin flip. Nothing is
   * exposed while the timer runs: the gate is already up and already opaque.
   *
   * `episode` and `appActive` are dependencies purely so that a change to either
   * re-runs this effect. The values it *decides* with come from the refs, because
   * those decisions are synchronous and have to see the current value rather
   * than the one this closure was created with.
   */
  useEffect(() => {
    if (!locked || recovered || !biometricAvailable) {
      return;
    }
    const current = episodeRef.current;
    if (callInterruptsLock(callSignal.current)) {
      presentedRef.current = current;
      return;
    }
    /**
     * A call-born episode inside its grace owes no prompt. It schedules a re-run
     * for the moment the grace ends instead of giving up, so an accept whose
     * navigation failed - or whose call was already over - still gets its prompt
     * rather than sitting behind an exemption that never expires.
     *
     * This is the one place the exemption is honoured, which is what keeps it
     * from being a global mute. The PIN pad is up for the whole of the grace, so
     * a user who is not actually in a call can get in immediately regardless.
     */
    if (
      callBornMayWithholdPrompt({
        bornEpisode: callBorn?.episode ?? -1,
        episode: current,
        bornAt: callBorn?.at ?? 0,
      })
    ) {
      const timer = setTimeout(
        () => setCallBorn(null),
        CALL_BORN_PROMPT_GRACE_MS - (Date.now() - (callBorn?.at ?? 0)) + 1,
      );
      return () => clearTimeout(timer);
    }
    if (
      !mayPresentPrompt({
        episode: current,
        presentedEpisode: presentedRef.current,
        presenting: promptInFlight.current,
        appActive: appActiveRef.current,
        cooldownRemainingMs: lockoutUntil.current - Date.now(),
      })
    ) {
      return;
    }
    const timer = setTimeout(() => {
      // Re-checked at the moment of firing, not just when the timer was set: the
      // episode can move underneath a pending timer, and a call can arrive inside
      // the window. A stale check would present a prompt over either.
      if (
        mayPresentPrompt({
          episode: episodeRef.current,
          presentedEpisode: presentedRef.current,
          presenting: promptInFlight.current,
          appActive: appActiveRef.current,
          cooldownRemainingMs: lockoutUntil.current - Date.now(),
        })
      ) {
        void runBiometric();
      }
    }, AUTO_PROMPT_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [
    locked,
    recovered,
    biometricAvailable,
    episode,
    appActive,
    prompting,
    callBorn,
    runBiometric,
  ]);

  /**
   * A call that arrives while the gate is up takes the gate down.
   *
   * Only a call that has been *answered* does this. One that is merely ringing
   * leaves the gate alone: the user accepts it from the native ring activity,
   * which draws over this screen, and letting a ringing call switch the lock off
   * would hand the conversation to anyone who can reach the user's handle.
   */
  useEffect(() => {
    if (!locked || !callReleasesGate(callSignal.current)) {
      return;
    }
    releaseGate();
  }, [locked, connectedCall, callScreenVisible, releaseGate]);

  const shakeOnError = useCallback(() => {
    if (reduceMotion) {
      return;
    }
    Animated.sequence([
      Animated.timing(shake, { toValue: 1, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: -1, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 0.5, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start();
  }, [reduceMotion, shake]);

  const submitPin = useCallback(async () => {
    if (!isValidPinFormat(pin)) {
      setMessage({
        tone: 'error',
        text: `Enter between ${PIN_MIN_LENGTH} and ${PIN_MAX_LENGTH} digits.`,
      });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const result = await verifyPin(pin);
      if (result.ok) {
        setPin('');
        setLocked(false);
        setMessage(null);
        return;
      }
      setLockedUntil(result.lockedUntil ?? 0);
      setNow(Date.now());
      if (result.locked) {
        setMessage({ tone: 'error', text: 'Too many attempts. Wait a moment, then try again.' });
      } else {
        setMessage({ tone: 'error', text: 'That PIN is not right.' });
      }
      setPin('');
      shakeOnError();
    } catch (error) {
      if (error instanceof SecureStoreUnavailableError) {
        // Never phrase this as a wrong PIN: the verifier may be perfectly fine and
        // the store unreadable, and "that PIN is not right" would send the user
        // round a loop guessing a PIN that works.
        setMessage({
          tone: 'error',
          text: 'This device can no longer read its secure storage.',
        });
      } else {
        setMessage({ tone: 'error', text: 'Could not check the PIN. Try again.' });
      }
      setPin('');
    } finally {
      setBusy(false);
    }
  }, [pin, shakeOnError]);

  // ---------------------------------------------------------------- recovery

  const recover = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    let wiped = false;

    /**
     * Sign out FIRST.
     *
     * Order matters: `clearAll()` deletes the session token too, and signing out
     * is the only step that revokes it on the server. Signing out also runs
     * entirely through AsyncStorage and Convex, so it still works when the thing
     * that is broken is the keystore. That is what makes this path unconditional:
     * no sequence of wrong PINs and no amount of keystore damage can reach a
     * state the user cannot leave.
     */
    try {
      await signOut();
    } catch {
      // Nothing better to do; the wipe below still runs.
    }

    try {
      await clearAll();
      wiped = true;
    } catch {
      /**
       * `clearAll` wipes everything in one pass. If that backend is unhappy,
       * take the verifier out on its own and leave the flag off, rather than
       * leaving a PIN behind that the user has just told us they cannot remember.
       */
      try {
        await clearPin();
        await writeLockConfig({ enabled: false, graceMs: DEFAULT_LOCK_GRACE_MS });
        wiped = true;
      } catch {
        wiped = false;
      }
    }

    setBusy(false);
    cancelBiometricPrompt();
    promptInFlight.current = false;
    suppressFailureCopy.current = true;
    setPrompting(false);

    /**
     * Release the gate either way.
     *
     * The user is signed out, so there is no session behind this screen any more
     * and nothing left to protect. Holding the gate shut over an unwritable
     * keystore would be the brick this whole design is arranged to avoid.
     *
     * If the wipe itself failed, the PIN is still on disk and the lock will be
     * back on next sign-in. That is survivable - the user can repeat this reset -
     * and it is not visible from here, because this screen is already gone by the
     * time it finishes. So it goes to the log rather than to a message box the
     * user never sees.
     */
    if (!wiped) {
      console.warn(
        '[app-lock] signed out, but the secure store could not be wiped; the lock will return on next sign-in',
      );
    }
    setRecovered(true);
    setLocked(false);
    await refresh();
  }, [refresh, signOut]);

  const confirmRecover = useCallback(() => {
    Alert.alert(
      'Reset the app lock?',
      `You will be signed out and ${APP_NAME} will forget its saved PIN and settings on this device. You will need to sign in again. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign out and reset', style: 'destructive', onPress: () => void recover() },
      ],
    );
  }, [recover]);

  // ---------------------------------------------------------------- render

  /**
   * Nothing to lock without a session.
   *
   * The login screen shows no messages, so gating it protects nothing and would
   * only make a signed-out device harder to sign into.
   */
  if (!token) {
    return null;
  }

  /**
   * Before the config has been read, render an opaque panel rather than nothing.
   *
   * Returning `null` here would let the navigator paint chat content for one
   * frame on a cold start of a locked app - long enough to land in the recents
   * snapshot, which is exactly the leak `FLAG_SECURE` is there to stop.
   */
  if (!resolved) {
    return (
      <View
        style={[styles.fill, styles.splash, { backgroundColor: colors.background }]}
        accessibilityViewIsModal
      >
        <ActivityIndicator color={colors.onSurfaceVariant} />
      </View>
    );
  }

  if (unsupported || recovered || !locked) {
    return null;
  }

  const translateX = shake.interpolate({
    inputRange: [-1, 1],
    outputRange: [-10, 10],
  });

  /**
   * Errors get full-contrast on-surface, informational text gets the dimmer
   * variant. The distinction is weight and contrast, never hue.
   */
  const tone = (value: StatusTone) =>
    value === 'error' ? colors.onSurface : colors.onSurfaceVariant;

  // Not `useMemo`: a hook here would be called after the early returns above,
  // which changes the hook count when a session appears or disappears.
  const messageText = message?.text ?? '';

  return (
    <Animated.View
      style={[
        styles.fill,
        { backgroundColor: colors.background, transform: recoveryOnly ? [] : [{ translateX }] },
      ]}
      // Keeps TalkBack inside the lock screen instead of letting it swipe through
      // to the conversation behind the overlay.
      accessibilityViewIsModal
      importantForAccessibility="yes"
    >
      <View
        style={[
          styles.body,
          {
            paddingTop: insets.top + 24,
            // Keyboard-aware bottom inset: with `adjustResize` the window is
            // already shrunk, so the safe-area bottom inset alone would push the
            // Unlock button off-screen once the number pad is up.
            paddingBottom: (keyboardVisible ? 12 : insets.bottom + 24),
          },
        ]}
      >
        <View style={styles.header}>
          <MaterialDesignIcons
            name="lock-outline"
            size={40}
            color={colors.onSurface}
            accessibilityElementsHidden
          />
          <Text variant="headlineSmall" style={{ color: colors.onSurface }}>
            {APP_NAME} is locked
          </Text>
          {/*
            One sentence, one per surface, and it always names what is actually
            going to happen - which is why this reads `surface` rather than
            re-deriving the question. There is no fourth case: `surface` has
            three values and this has three sentences, so the copy cannot
            describe something the screen is not showing.

            While a prompt is up the screen says so, because a screen-reader user
            is otherwise told nothing at all when a system dialog they cannot see
            took focus - `polite` rather than `assertive` because this is not an
            error, and interrupting for good news is its own kind of wrong.
          */}
          <Text
            variant="bodyMedium"
            accessibilityLiveRegion="polite"
            style={[styles.subtitle, { color: colors.onSurfaceVariant }]}
          >
            {SURFACE_SUBTITLE[surface]}
          </Text>
        </View>

        {messageText ? (
          <Text
            variant="bodyMedium"
            accessibilityLiveRegion="polite"
            style={[styles.message, { color: tone(message?.tone ?? 'info') }]}
          >
            {messageText}
          </Text>
        ) : null}

        {cooldownRemaining > 0 ? (
          <Text
            variant="labelLarge"
            accessibilityLiveRegion="polite"
            style={[styles.countdown, { color: colors.onSurfaceVariant }]}
          >
            Try again in {formatCountdown(cooldownRemaining)}
          </Text>
        ) : null}

        {showPinField ? (
          <View style={styles.pinArea}>
            {/*
              No transform on the field: the outer animated view already shakes the
              whole panel. Shaking both would double the amplitude and make the
              error text jitter independently of the input.
            */}
            <PinField
              label="App lock PIN"
              value={pin}
              onChange={setPin}
              onSubmit={submitPin}
              // Never steal focus while the OS prompt is up: on Android the two
              // fight, and the number pad appearing under a fingerprint dialog is
              // how the prompt gets dismissed by a stray tap.
              autoFocus={!prompting}
              disabled={busy || cooldownRemaining > 0}
            />
            <Button
              mode="contained"
              onPress={submitPin}
              disabled={busy || cooldownRemaining > 0}
              loading={busy}
              accessibilityRole="button"
              accessibilityLabel="Unlock with PIN"
              accessibilityHint="Checks the PIN you entered"
              accessibilityState={{ disabled: busy || cooldownRemaining > 0, busy }}
            >
              Unlock
            </Button>
          </View>
        ) : null}

        <View style={styles.actions}>
          {recoveryOnly ? (
            <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
              No PIN is stored on this device and biometrics are unavailable, so there is
              nothing to unlock with.
            </Text>
          ) : null}

          {/*
            Always available, never rate-limited, never conditional on the store.
            The wrong-PIN backoff in SecureStoreModule is explicitly capped at 15
            minutes and has no terminal state; this is the path that makes that
            safe.
          */}
          <Pressable
            onPress={confirmRecover}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Forgot your PIN? Sign out and reset the app lock"
            accessibilityHint="Signs you out and erases the app lock and its settings on this device"
            accessibilityState={{ disabled: busy }}
            style={({ pressed }) => [styles.forgot, { opacity: pressed ? 0.6 : 1 }]}
          >
            <MaterialDesignIcons
              name="help-circle-outline"
              size={18}
              color={colors.onSurfaceVariant}
              accessibilityElementsHidden
            />
            <Text variant="labelLarge" style={{ color: colors.onSurfaceVariant }}>
              {recoveryOnly ? 'Sign out and reset' : 'Forgot your PIN?'}
            </Text>
          </Pressable>
        </View>
      </View>
    </Animated.View>
  );
};

export default AppLock;

/**
 * Whether the app lock is currently covering the app.
 *
 * `App.tsx` reads this to set `importantForAccessibility="no-hide-descendants"` on
 * the navigator while the gate is up. `accessibilityViewIsModal` inside
 * `AppLock` only confines VoiceOver; on Android, TalkBack would otherwise still
 * swipe straight through the overlay to the conversation behind it. An opaque
 * overlay is not an accessibility barrier.
 */
export function useIsAppLockActive(): boolean {
  return useAppLock(state => state.gateActive);
}

// Exported for Settings, which sets and changes the PIN through the same field
// and must not end up with a second, differently-behaved PIN widget.
export { PinField };

const styles = StyleSheet.create({
  fill: {
    ...StyleSheet.absoluteFillObject,
  },
  splash: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    paddingHorizontal: 24,
  },
  header: {
    alignItems: 'center',
    gap: 8,
  },
  subtitle: {
    textAlign: 'center',
  },
  message: {
    marginTop: 20,
    textAlign: 'center',
  },
  countdown: {
    marginTop: 6,
    textAlign: 'center',
  },
  pinArea: {
    marginTop: 24,
    gap: 12,
  },
  input: {
    height: 56,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 20,
    letterSpacing: 8,
  },
  actions: {
    marginTop: 'auto',
    gap: 12,
    alignItems: 'stretch',
  },
  forgot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
  },
});