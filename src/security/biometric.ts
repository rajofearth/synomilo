import { NativeModules, Platform } from 'react-native';

/**
 * Typed JS face of `BiometricGateModule` (android/.../BiometricGateModule.kt).
 *
 * ------------------------------------------------------------------------
 * SECURITY: this module cannot obtain biometric data, and neither can this file.
 * ------------------------------------------------------------------------
 * A fingerprint or face template never leaves the protected hardware that captured
 * it. Android exposes exactly two things to an app: a yes/no "a human just proved
 * presence", and (optionally) a handle to an auth-bound key. `BiometricGate` returns
 * the first and nothing else - it deliberately passes no `CryptoObject`, so there
 * is no key handle here either. There is therefore no sample to hash, no template
 * to salt, and nothing to encrypt: any attempt to "store a fingerprint" would be
 * both impossible through the platform and unlawful. Do not add one.
 *
 * What this file adds on top of the native module is only ergonomics and one
 * deliberate policy decision: every call is non-throwing. A missing module, a
 * rejected promise, an unexpected status - all become values the lock screen can
 * render, because a lock screen that throws renders nothing and shows the user
 * their conversation.
 */

/** Module name from `BiometricGateModule.getName()`. */
const MODULE_NAME = 'BiometricGate';

/**
 * `androidx.biometric.BiometricManager` status codes.
 *
 * Duplicated here rather than imported because they are ints on the bridge and
 * there is no JS-side constant table. `getAvailability()` also returns a resolved
 * `reason` string, which is what callers should branch on - these exist for
 * diagnostics and for `status === 0` assertions in tests.
 */
export const BIOMETRIC_STATUS = {
  UNKNOWN: -1,
  SUCCESS: 0,
  ERROR_HW_UNAVAILABLE: 1,
  ERROR_NONE_ENROLLED: 11,
  ERROR_NO_HARDWARE: 12,
  ERROR_SECURITY_UPDATE_REQUIRED: 15,
  ERROR_UNSUPPORTED: -2,
} as const;

/**
 * `BiometricPrompt.ERROR_*` codes, as they come back in `errorCode`.
 *
 * Only the ones that change what the UI should do are named. A `BiometricPrompt`
 * error is *not* the same thing as a failure to match: `onAuthenticationFailed`
 * (a rejected finger) never reaches us at all, because the native module keeps the
 * prompt up and lets the user retry - see `onAuthenticationFailed` in the Kotlin.
 * So a wrong finger is not an error and is not counted anywhere.
 */
export const BIOMETRIC_ERROR = {
  HW_UNAVAILABLE: 1,
  TIMEOUT: 3,
  CANCELED: 5,
  LOCKOUT: 7,
  LOCKOUT_PERMANENT: 9,
  USER_CANCELED: 10,
  NO_BIOMETRICS: 11,
  HW_NOT_PRESENT: 12,
  NEGATIVE_BUTTON: 13,
  NO_DEVICE_CREDENTIAL: 14,
} as const;

/**
 * Resolved `reason` values from `getAvailability()`, plus the permission case.
 *
 * `permissionMissing` means `USE_BIOMETRIC` is absent from the merged manifest.
 * The native module checks it and reports it rather than throwing, so an install
 * that forgot the permission degrades to the PIN instead of showing a dead
 * Unlock button.
 */
export type BiometricReason =
  | 'ok'
  | 'noHardware'
  | 'hwUnavailable'
  | 'noneEnrolled'
  | 'unsupported'
  | 'unknown'
  | 'permissionMissing';

export type BiometricAvailability = {
  /** True only when `canAuthenticate(BIOMETRIC_STRONG | DEVICE_CREDENTIAL)` succeeded. */
  available: boolean;
  reason: BiometricReason;
  /** Raw `BiometricManager` status, for diagnostics. */
  status: number;
  /** Android 11+ only: a PIN/pattern/password is set, so the prompt can fall back to it. */
  deviceCredentialAvailable: boolean;
};

/** Terminal outcome of a presented prompt. Mirrors the native `STATUS_*` constants. */
export type BiometricOutcome = 'success' | 'cancelled' | 'lockout' | 'unavailable' | 'error';

export type BiometricMethod = 'biometric' | 'deviceCredential' | 'unknown';

export type BiometricResult = {
  status: BiometricOutcome;
  /** Only on `success`: whether a finger/face or the device credential got them in. */
  method?: BiometricMethod;
  /** Present on `unavailable`: the same `reason` vocabulary as `getAvailability`. */
  reason?: BiometricReason;
  /** `BiometricPrompt.ERROR_*` on `error`/`lockout`/`cancelled`, `BiometricManager` status on `unavailable`. */
  errorCode?: number;
  /**
   * Diagnostic only, never displayed.
   *
   * Two different things land here and the caller cannot tell them apart, which is
   * exactly why it must not be rendered: an OS-supplied `errString` from the prompt,
   * and - when the failure happened before the prompt could be built at all - the
   * bridge rejection code (`E_ACTIVITY_NOT_RESUMED`, `E_PROMPT_IN_FLIGHT`, ...).
   * OEM translations of the former are frequently alarming ("Biometric authentication
   * error"); the latter is the one genuinely diagnostic signal, so
   * `describeBiometricFailure` branches on it by value.
   */
  message?: string;
};

/** How loudly a failure line is drawn. Severity is contrast, never hue. */
export type FailureTone = 'info' | 'error';

/**
 * Promise-returning half of the native module.
 *
 * `cancel()` is intentionally absent: it returns nothing (no promise), so it does
 * not belong on a promise-returning surface. It is exposed separately below.
 */
type BiometricGateNative = {
  getAvailability(): Promise<{
    available: boolean;
    reason: BiometricReason;
    status: number;
    deviceCredentialAvailable: boolean;
  }>;
  authenticate(
    title: string,
    subtitle: string | null,
    negativeLabel: string | null,
  ): Promise<BiometricResult>;
  setSecureWindow(enabled: boolean): Promise<boolean>;
  isSecureWindowEnabled(): Promise<boolean>;
  cancel(): void;
};

const bridge = (): BiometricGateNative | undefined =>
  (NativeModules as Record<string, unknown>)[MODULE_NAME] as
    | BiometricGateNative
    | undefined;

const isSupportedPlatform = Platform.OS === 'android';

/**
 * The module is absent on iOS (and would be absent if `CallPackage` were ever
 * un-registered). Treating that as "no biometrics" rather than as a crash is the
 * whole point: the lock screen has a PIN path that must keep working.
 */
const unavailable = (reason: BiometricReason): BiometricAvailability => ({
  available: false,
  reason,
  status: BIOMETRIC_STATUS.ERROR_NO_HARDWARE,
  deviceCredentialAvailable: false,
});

/**
 * What the device can do.
 *
 * Never throws. A rejection or a missing module resolves to an unavailable
 * availability, which routes the user to the PIN - the one thing that is always
 * available when the lock is on.
 */
export async function getBiometricAvailability(): Promise<BiometricAvailability> {
  if (!isSupportedPlatform) {
    return unavailable('unsupported');
  }
  try {
    const result = await bridge()?.getAvailability?.();
    if (!result || typeof result.available !== 'boolean') {
      return unavailable('unknown');
    }
    return {
      available: result.available,
      reason: result.reason ?? 'unknown',
      status: typeof result.status === 'number' ? result.status : BIOMETRIC_STATUS.UNKNOWN,
      deviceCredentialAvailable: result.deviceCredentialAvailable === true,
    };
  } catch {
    return unavailable('hwUnavailable');
  }
}

/**
 * True when the PIN should be the primary affordance rather than the biometric
 * prompt: no hardware, nothing enrolled, an unsupported class, a missing
 * manifest permission, or hardware that is temporarily busy.
 */
export function shouldOfferPinFirst(availability: BiometricAvailability): boolean {
  return !availability.available;
}

export type AuthenticateOptions = {
  title: string;
  subtitle?: string | null;
};

/**
 * Shows the system prompt and resolves with what happened.
 *
 * Never rejects, on purpose. The native module rejects for exactly one class of
 * caller error - asking with no foreground `FragmentActivity` to host it - and
 * every rejection it can produce (`E_NO_ACTIVITY`, `E_ACTIVITY_NOT_RESUMED`,
 * `E_PROMPT_IN_FLIGHT`, `E_NOT_FRAGMENT_ACTIVITY`, `E_PERMISSION_MISSING`)
 * means the same thing to this screen: "the prompt is not up right now, let the
 * user try again from a button". Turning that into a value is what keeps an
 * unlucky moment (a call arriving, the prompt dismissing on backgrounding) from
 * becoming a thrown error inside a render path.
 *
 * `negativeLabel` is accepted by the native signature and deliberately not
 * forwarded. When `DEVICE_CREDENTIAL` is one of the allowed authenticators,
 * `BiometricPrompt` throws `IllegalArgumentException` if negative-button text is
 * also set - the system draws its own "Use PIN" action instead. Passing one
 * breaks authentication outright on every API level this app supports, so the
 * null is passed as a literal rather than left to chance.
 */
export async function authenticateWithBiometrics(
  options: AuthenticateOptions,
): Promise<BiometricResult> {
  if (!isSupportedPlatform) {
    return { status: 'unavailable', reason: 'unsupported' };
  }
  const gate = bridge();
  if (!gate?.authenticate) {
    return { status: 'unavailable', reason: 'unknown' };
  }
  try {
    const result = await gate.authenticate(options.title, options.subtitle ?? null, null);
    return result && typeof result.status === 'string'
      ? result
      : { status: 'error' };
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    // Every rejection this module can raise means "not showing right now". None of
    // them is a denial by the user, so none of them is `cancelled`.
    return code === 'E_NO_ACTIVITY' ||
      code === 'E_NOT_FRAGMENT_ACTIVITY' ||
      code === 'E_ACTIVITY_GONE' ||
      code === 'E_ACTIVITY_NOT_RESUMED' ||
      code === 'E_PERMISSION_MISSING' ||
      code === 'E_PROMPT_IN_FLIGHT' ||
      code === 'E_BIOMETRIC_UNAVAILABLE'
      ? { status: 'unavailable', reason: 'unknown', message: code }
      : { status: 'error', message: code ?? 'unknown' };
  }
}

/**
 * Dismisses a showing prompt.
 *
 * Also clears the native in-flight guard, so a prompt that the system dismissed
 * while the app was backgrounded does not leave the next attempt permanently
 * rejected as "already in progress". Fire-and-forget: the native method has no
 * promise and reports nothing.
 */
export function cancelBiometricPrompt(): void {
  try {
    bridge()?.cancel?.();
  } catch {
    // Nothing to do. A prompt that could not be cancelled will report itself.
  }
}

/**
 * Whether `FLAG_SECURE` is currently on the host activity's window.
 *
 * Reported, not asserted. `BiometricGateModule` applies the flag from an
 * `ActivityEventListener` on every resume, because a flag set from JS arrives
 * after the activity has already been paused - too late for the recents
 * snapshot, which is the capture this exists to prevent.
 */
export async function isSecureWindowEnabled(): Promise<boolean> {
  if (!isSupportedPlatform) {
    return false;
  }
  try {
    return (await bridge()?.isSecureWindowEnabled?.()) === true;
  } catch {
    return false;
  }
}

/**
 * Escape hatch for the screenshot-blocking policy.
 *
 * Present for completeness and deliberately not wired to any control: clearing
 * `FLAG_SECURE` re-opens the app-switcher snapshot that leaks message content, so
 * there is no UI in this app that can reach it. Kept as a single-line call in
 * case the policy ever needs to be relaxed from one place instead of by editing
 * native code.
 */
export async function setSecureWindowEnabled(enabled: boolean): Promise<boolean> {
  if (!isSupportedPlatform) {
    return false;
  }
  try {
    return (await bridge()?.setSecureWindow?.(enabled)) === true;
  } catch {
    return false;
  }
}

/**
 * Whether a biometric outcome should hand the user to the PIN.
 *
 * `success` is the only outcome that does not. `cancelled` is included because
 * the prompt can be dismissed without ever being tried (a notification shade
 * pull, an incoming call), and re-presenting it automatically in that case is
 * how an app ends up fighting the user.
 */
export function biometricFailed(result: BiometricResult): boolean {
  return result.status !== 'success';
}

/** A failure line for the lock screen: what happened, and what to do next. */
export type BiometricFailureCopy = {
  tone: FailureTone;
  text: string;
};

/**
 * What the caller is told after a failed attempt.
 *
 * ------------------------------------------------------------------------
 * WHY THIS IS A TABLE AND NOT A `switch` WITH FOUR CASES
 * ------------------------------------------------------------------------
 * The old version had four branches and two of them produced the bare word
 * "failed" - "Unlock failed. Use your PIN." - which tells the user nothing they
 * can act on and reads as the app having broken. Every outcome this module can
 * produce has a *cause the user could name*: the sensor is busy, nothing is
 * enrolled, the screen changed before the prompt could open, Android has locked
 * biometrics after too many tries. Those get their own sentence, and every one of
 * them ends with the single next action that actually works.
 *
 * The second half of the rule is the tail. `pinAvailable` decides what the user
 * is pointed at, and it is always the same thing that is actually on screen: the
 * PIN pad, or - on the one install with no PIN to fall back to - the sign-out and
 * reset control. There is no state in which the copy names a button the screen
 * is not showing.
 *
 * `result.message` is deliberately never rendered. See `BiometricResult.message`.
 */
export function describeBiometricFailure(
  result: BiometricResult,
  options: { pinAvailable: boolean },
): BiometricFailureCopy {
  const next = options.pinAvailable
    ? 'Enter your PIN below to unlock.'
    : 'Use the sign-out and reset option below to get back in.';

  /**
   * Failures raised before the prompt was ever built. These arrive as
   * `{ status: 'unavailable', reason: 'unknown', message: <bridge code> }`, and the
   * code is the only thing that distinguishes "your screen changed underneath me"
   * from "something is wrong with this build". Treating them all as one generic
   * "not available" is what produced the unhelpful copy in the first place.
   */
  switch (result.message) {
    case 'E_ACTIVITY_NOT_RESUMED':
      return {
        tone: 'info',
        text: `The screen was still opening when the fingerprint check was due to appear. ${next}`,
      };
    case 'E_NO_ACTIVITY':
    case 'E_ACTIVITY_GONE':
      return {
        tone: 'info',
        text: `The screen changed before the fingerprint check could open. ${next}`,
      };
    case 'E_PROMPT_IN_FLIGHT':
      return {
        tone: 'info',
        text: `A fingerprint check was already open, so a second one was not started. ${next}`,
      };
    case 'E_NOT_FRAGMENT_ACTIVITY':
      return {
        tone: 'error',
        text: `This screen cannot host the fingerprint check. ${next}`,
      };
    case 'E_PERMISSION_MISSING':
      return {
        tone: 'error',
        text: `This version of the app is not permitted to use fingerprint unlock. ${next}`,
      };
    case 'E_BIOMETRIC_UNAVAILABLE':
      return {
        tone: 'info',
        text: `The fingerprint service could not be reached this time. ${next}`,
      };
    default:
      break;
  }

  if (result.status === 'lockout') {
    return {
      tone: 'error',
      // Android's own backoff. Stating that it lifts by itself is the actionable
      // half: without it, "locked" reads as "broken" and the user signs out.
      text: `Android has locked fingerprint and face unlock after too many attempts. It clears by itself after a short wait - ${next.toLowerCase()}`,
    };
  }

  if (result.status === 'cancelled') {
    return {
      tone: 'info',
      text: `The fingerprint check was dismissed before it finished. ${next}`,
    };
  }

  if (result.status === 'unavailable') {
    return { tone: 'info', text: `${unavailableReasonCopy(result.reason)} ${next}` };
  }

  // `status === 'error'`: the prompt opened and something ended it abnormally.
  if (result.errorCode === BIOMETRIC_ERROR.TIMEOUT) {
    return {
      tone: 'info',
      text: `The fingerprint check timed out before a finger was read. ${next}`,
    };
  }

  return {
    tone: 'error',
    text: `The fingerprint check stopped before it could confirm anything. ${next}`,
  };
}

/**
 * Why biometrics are not usable, from `getAvailability()`'s own vocabulary.
 *
 * "Not available" is the answer almost nobody can act on. Each of these names the
 * specific thing that is missing or wrong and, where one exists, the specific place
 * to fix it.
 */
const unavailableReasonCopy = (reason: BiometricReason | undefined): string => {
  switch (reason) {
    case 'noHardware':
      return 'This device has no fingerprint reader or face unlock.';
    case 'noneEnrolled':
      return 'No fingerprint or face is set up on this device. Add one in Android Settings, or';
    case 'hwUnavailable':
      return 'The fingerprint sensor is busy, which usually means it is still waking after a restart.';
    case 'unsupported':
      return 'This device does not support fingerprint unlock.';
    case 'permissionMissing':
      return 'This version of the app is not permitted to use fingerprint unlock.';
    default:
      return 'Fingerprint unlock is not available right now.';
  }
};

/**
 * How long the app should wait before offering the prompt again after an OS
 * lockout, in milliseconds.
 *
 * The OS's own backoff for `ERROR_LOCKOUT` is 30 seconds. Offering a "try again"
 * control before then produces a prompt that can only fail, so the control is
 * disabled for this long and says so.
 */
export const BIOMETRIC_RETRY_COOLDOWN_MS = 30_000;

/**
 * Whether a "try fingerprint again" control should be offered at all right now.
 *
 * True only after a genuine attempt. Before the first prompt of an episode there
 * is nothing to retry - the prompt is being presented automatically - and offering
 * a button that merely re-runs the automatic path is the two-step affordance this
 * flow exists to remove.
 */
export function canRetryBiometric(args: {
  attempted: boolean;
  presenting: boolean;
  cooldownRemainingMs: number;
  lockoutCooldownRemainingMs: number;
}): boolean {
  return (
    args.attempted &&
    !args.presenting &&
    args.cooldownRemainingMs <= 0 &&
    args.lockoutCooldownRemainingMs <= 0
  );
}