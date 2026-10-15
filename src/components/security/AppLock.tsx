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
import { create } from 'zustand';
import { useSession } from '../../auth/SessionProvider';
import { useIsKeyboardVisible } from '../../hooks/useIsKeyboardVisible';
import { useCallStore } from '../calls/callStore';
import { APP_NAME } from '../../utils/AppConstants';
import {
  authenticateWithBiometrics,
  cancelBiometricPrompt,
  describeBiometricFailure,
  getBiometricAvailability,
} from '../../security/biometric';
import type { BiometricAvailability } from '../../security/biometric';
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
  readLockConfig,
  secureBackendInfo,
  verifyPin,
  wasAppLockEverConfigured,
  writeLockConfig,
} from '../../security/secureStore';

/**
 * ------------------------------------------------------------------------
 * THE APP LOCK
 * ------------------------------------------------------------------------
 *
 * Biometric first, app PIN second, and a reset path that always works.
 *
 * Nothing biometric is ever captured, hashed or stored here or anywhere else. The
 * OS returns a verified/not-verified result and nothing else, so the only secret
 * this feature owns is the app PIN, and that exists only as a salted PBKDF2
 * verifier inside the encrypted store (see src/security/secureStore.ts). The
 * fingerprint is a *gate* the OS holds; the PIN is the *key* this app holds.
 *
 * Three rules the rest of this file exists to keep:
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

  const [showPin, setShowPin] = useState(false);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: StatusTone; text: string } | null>(null);
  const [lockedUntil, setLockedUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  const backgroundedAt = useRef<number | null>(null);
  const promptedThisEpisode = useRef(false);
  const promptInFlight = useRef(false);
  const shake = useRef(new Animated.Value(0)).current;

const biometricAvailable = availability?.available === true;
const storeBroken = status === 'storeBroken';
const unsupported = status === 'unsupported';

/**
 * Whether the PIN can be offered at all.
 *
 * `pinSet` is only meaningful when the store could actually be read. On a
 * `storeBroken` install `hasPin()` threw, which says nothing about whether a
 * verifier exists - so the field is hidden rather than offered on a guess.
 */
const pinUsable = pinSet && !storeBroken;

/**
 * Whether there is any way forward that does not involve a reset.
 *
 * A lock with nothing to unlock *with* cannot be satisfied, and pretending
 * otherwise would present an Unlock button that can never work.
 */
const recoveryOnly = !pinUsable && !biometricAvailable;

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
   * Every path that decides "locked" goes through here so the per-episode state
   * (whether the prompt has already fired, whether the PIN field is showing) can
   * never drift out of sync with the locked flag - the auto-prompt is guarded by
   * exactly one ref, and this is what resets it.
   */
  const armLock = useCallback(() => {
    promptedThisEpisode.current = false;
    setLocked(true);
    setShowPin(false);
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
        return;
      }
      if (next !== 'active') {
        return;
      }

      const leftAt = backgroundedAt.current;
      backgroundedAt.current = null;
      if (leftAt === null) {
        return;
      }

      // The prompt itself can dip the app out of foreground. Returning from it is
      // not an excursion.
      if (promptInFlight.current) {
        return;
      }
      /**
       * Never cover a live call.
       *
       * Backgrounding to answer the door and coming back to a lock screen over an
       * active call would put a PIN pad between the user and the person they are
       * talking to. Read-only use of the call store; nothing in it is modified.
       */
      if (useCallStore.getState().active !== null) {
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

  const runBiometric = useCallback(async () => {
    if (!biometricAvailable || promptInFlight.current) {
      return;
    }
    promptInFlight.current = true;
    promptedThisEpisode.current = true;
    setBusy(true);
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
      // Anything else - a cancel, a lockout, a dismissal - lands on the PIN rather
      // than re-presenting. Re-presenting automatically is how an app ends up
      // arguing with the user.
      setShowPin(true);
      setMessage({ tone: result.status === 'lockout' ? 'error' : 'info', text: describeBiometricFailure(result) });
    } finally {
      promptInFlight.current = false;
      setBusy(false);
    }
  }, [biometricAvailable]);

  /**
   * Auto-trigger, exactly once per lock episode.
   *
   * If the OS refuses to show the prompt - no foreground activity, the activity
   * is not resumed, a prompt is already up - the screen still renders with a
   * visible Unlock control, so there is always something to press.
   */
  useEffect(() => {
    if (!locked || recovered || promptedThisEpisode.current || !biometricAvailable) {
      return;
    }
    if (!pinUsable) {
      setShowPin(false);
    }
    // Set before the call, not after: `runBiometric` is async, and a second pass
    // through this effect while it is in flight must not present a second prompt.
    promptedThisEpisode.current = true;
    runBiometric();
    // `promptedThisEpisode` is a ref and is deliberately absent from this list:
    // reading it in a dependency array does not subscribe to anything, and
    // including it would suggest a guarantee it cannot provide.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked, recovered, biometricAvailable, pinUsable, runBiometric]);

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

  const showPinField = showPin && pinUsable;

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
          <Text variant="bodyMedium" style={[styles.subtitle, { color: colors.onSurfaceVariant }]}>
            {recoveryOnly
              ? 'This device cannot verify who you are. Sign out to get back in.'
              : 'Confirm it is you to continue.'}
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
              autoFocus={!biometricAvailable}
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
          {biometricAvailable ? (
            <Button
              mode="contained"
              onPress={() => void runBiometric()}
              disabled={busy}
              loading={busy && showPinField === false}
              accessibilityRole="button"
              accessibilityLabel="Unlock with biometrics"
              accessibilityHint="Opens the system fingerprint or face prompt"
              accessibilityState={{ disabled: busy, busy }}
            >
              Unlock
            </Button>
          ) : null}

          {biometricAvailable && pinUsable && !showPinField ? (
            <Button
              mode="text"
              onPress={() => {
                setShowPin(true);
                setMessage(null);
              }}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Use PIN instead"
              accessibilityState={{ disabled: busy }}
            >
              Use PIN
            </Button>
          ) : null}

          {biometricAvailable && pinUsable && showPinField ? (
            <Button
              mode="text"
              onPress={() => {
                setShowPin(false);
                setPin('');
                setMessage(null);
              }}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Use biometrics instead"
              accessibilityState={{ disabled: busy }}
            >
              Use biometrics
            </Button>
          ) : null}

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