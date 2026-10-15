import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeModules, Platform } from 'react-native';

/**
 * Typed JS face of `SecureStoreModule` (android/.../SecureStoreModule.kt), plus
 * the one migration this module exists to perform.
 *
 * ------------------------------------------------------------------------
 * WHAT IS IN HERE, AND WHAT CAN NEVER BE
 * ------------------------------------------------------------------------
 * Two secrets, and only two:
 *
 *   1. The Convex session token. A bearer credential - whoever holds it *is* the
 *      user, no second factor - previously in plaintext AsyncStorage, i.e. an
 *      unencrypted SQLite file in the app sandbox that `adb backup` and root can
 *      read. It now lives encrypted under a non-exportable AndroidKeyStore key.
 *
 *   2. The app-lock PIN *verifier*: PBKDF2-HMAC-SHA256, 600k iterations, 32-byte
 *      per-install random salt, 256-bit output, stored as base64. `pin_length` is
 *      stored next to it - that is how many digits, not what they are. The PIN
 *      itself is never written and there is no read path that could return it.
 *      Verification is a constant-time `MessageDigest.isEqual` on the derived key.
 *
 * There is no biometric data in here and there cannot be. A fingerprint or face
 * template is captured, matched and stored inside the TEE/StrongBox and is never
 * exposed to an app, so there is nothing to hash, salt or encrypt - and no lawful
 * way to obtain it in the first place. The biometric prompt is a *gate* in front
 * of this data, not an ingredient of it.
 *
 * ------------------------------------------------------------------------
 * THE ONE RULE THIS FILE ENFORCES
 * ------------------------------------------------------------------------
 * A failing secure store is never reported as "nothing is stored".
 *
 * `hasPin()` resolving false because the Keystore entry was lost on a
 * device-to-device restore would silently unlock the app for whoever is holding
 * the phone. So every read here throws `SecureStoreUnavailableError` instead of
 * returning a benign-looking empty, and the lock screen turns that into an
 * explicit "sign out and reset" screen. An unreadable store costs the user a
 * re-login; it never costs them their lock.
 */

/** Module name from `SecureStoreModule.getName()`. */
const MODULE_NAME = 'SecureStore';

/** Native rejection code when the backend cannot be opened or read. */
const E_BACKEND = 'E_SECURE_STORE_UNAVAILABLE';

export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 6;

/**
 * Re-lock grace periods offered in Settings, in milliseconds.
 *
 * 30s is the default: a notification-shade pull, a quick app switch or an inline
 * reply notification all background the app for well under 30s and must not cost
 * a re-unlock, while stepping away from an unlocked phone for longer than that
 * does lock it.
 */
export const APP_LOCK_GRACE_OPTIONS: readonly { ms: number; label: string }[] = [
  { ms: 0, label: 'Immediately' },
  { ms: 15_000, label: 'After 15 seconds' },
  { ms: 30_000, label: 'After 30 seconds' },
  { ms: 60_000, label: 'After 1 minute' },
  { ms: 300_000, label: 'After 5 minutes' },
];

export const DEFAULT_LOCK_GRACE_MS = 30_000;

/** Keys owned by the app lock. All of them go through the encrypted store only. */
export const LOCK_KEYS = {
  enabled: 'applock.enabled',
  graceMs: 'applock.graceMs',
} as const;

/**
 * The one error type callers must handle.
 *
 * Distinct from a generic rejection because the *response* is different: an
 * unavailable store is not "no PIN" and not "wrong PIN", it is "this device can no
 * longer read its own secrets", and the only safe recovery is a sign-out.
 */
export class SecureStoreUnavailableError extends Error {
  readonly code = E_BACKEND;

  constructor(message = 'Secure store is unavailable') {
    super(message);
    this.name = 'SecureStoreUnavailableError';
  }
}

export type SecureBackendInfo = {
  /** `encryptedSharedPreferences` (primary) or `keystoreAesGcm` (fallback). */
  backend: string;
  available: boolean;
};

export type PinVerifyResult = {
  ok: boolean;
  /** True when the attempt was refused without being tried, because a delay is active. */
  locked: boolean;
  /**
   * Wall-clock ms until which attempts are refused.
   *
   * Optional on purpose: the native success branch returns `ok/locked/attempts`
   * without this key, so `undefined` is a real and expected shape, not a bug in
   * the wrapper. Normalised to 0 below.
   */
  lockedUntil?: number;
  attempts: number;
};

export type PinLockoutState = {
  attempts: number;
  lockedUntil: number;
  locked: boolean;
};

export type LockConfig = {
  enabled: boolean;
  graceMs: number;
};

type SecureStoreNative = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<null>;
  removeItem(key: string): Promise<null>;
  getAllKeys(): Promise<string[]>;
  getBackendInfo(): Promise<{ backend: string; available: boolean }>;
  hasPin(): Promise<boolean>;
  setPin(pin: string): Promise<null>;
  verifyPin(pin: string): Promise<{
    ok: boolean;
    locked: boolean;
    lockedUntil?: number;
    attempts: number;
  }>;
  clearPin(): Promise<null>;
  recordPinFailure(): Promise<{ attempts: number; lockedUntil: number; locked: boolean }>;
  getPinLockout(): Promise<{ attempts: number; lockedUntil: number; locked: boolean }>;
  resetPinFailures(): Promise<null>;
  clearAll(): Promise<null>;
};

const bridge = (): SecureStoreNative | undefined =>
  (NativeModules as Record<string, unknown>)[MODULE_NAME] as
    | SecureStoreNative
    | undefined;

/**
 * Whether the encrypted store exists at all.
 *
 * False on iOS and in any environment where `CallPackage` was not registered
 * (Jest, for one). Callers on those platforms use the AsyncStorage-backed
 * persistence below and have no app lock.
 */
export function isSecureStoreSupported(): boolean {
  return Platform.OS === 'android' && !!bridge();
}

const requireBridge = (): SecureStoreNative => {
  const gate = bridge();
  if (!gate) {
    throw new SecureStoreUnavailableError('SecureStore native module is not linked');
  }
  return gate;
};

/**
 * Normalises a native rejection into the one error type that has a documented
 * response, and leaves everything else alone so genuine bugs stay visible.
 */
const rethrow = (error: unknown): never => {
  const code = (error as { code?: string } | null)?.code;
  if (code === E_BACKEND || code === 'E_SECURE_STORE') {
    throw new SecureStoreUnavailableError(
      (error as Error)?.message ?? 'Secure store is unavailable',
    );
  }
  throw error;
};

// ------------------------------------------------------------------ generic store

/**
 * Reads one value from the encrypted store.
 *
 * @throws {SecureStoreUnavailableError} when the backend cannot be opened or read.
 */
export async function secureGet(key: string): Promise<string | null> {
  try {
    return await requireBridge().getItem(key);
  } catch (error) {
    return rethrow(error);
  }
}

/** @throws {SecureStoreUnavailableError} */
export async function secureSet(key: string, value: string): Promise<void> {
  try {
    await requireBridge().setItem(key, value);
  } catch (error) {
    return rethrow(error);
  }
}

/** @throws {SecureStoreUnavailableError} */
export async function secureRemove(key: string): Promise<void> {
  try {
    await requireBridge().removeItem(key);
  } catch (error) {
    return rethrow(error);
  }
}

/** @throws {SecureStoreUnavailableError} */
export async function secureGetAllKeys(): Promise<string[]> {
  try {
    return await requireBridge().getAllKeys();
  } catch (error) {
    return rethrow(error);
  }
}

/**
 * Which protection is actually active.
 *
 * Surfaced in Settings rather than hidden, because "encrypted at rest" is a
 * claim and this is the value that makes it checkable.
 */
export async function secureBackendInfo(): Promise<SecureBackendInfo> {
  try {
    const info = await requireBridge().getBackendInfo();
    return { backend: info.backend, available: info.available === true };
  } catch (error) {
    return rethrow(error);
  }
}

// ------------------------------------------------------------------ PIN verifier

/**
 * Mirrors the native format check exactly, so JS never spends a bridge round trip
 * (or an attempt) on input the native side would only reject.
 *
 * `^\d{4,6}$` would accept non-ASCII digits from some keyboard layouts, which
 * the native `pin.all { it in '0'..'9' }` does not. Hence the explicit character
 * class rather than the shorthand.
 */
export function isValidPinFormat(pin: string): boolean {
  if (pin.length < PIN_MIN_LENGTH || pin.length > PIN_MAX_LENGTH) {
    return false;
  }
  for (let i = 0; i < pin.length; i += 1) {
    const code = pin.charCodeAt(i);
    if (code < 48 || code > 57) {
      return false;
    }
  }
  return true;
}

/**
 * Whether a PIN verifier exists.
 *
 * Rejects rather than returning false when the store is broken. Callers must not
 * write `await hasPin() || false` - that expression is a lockout bypass.
 */
export async function hasPin(): Promise<boolean> {
  try {
    return (await requireBridge().hasPin()) === true;
  } catch (error) {
    return rethrow(error);
  }
}

/**
 * Writes a verifier: fresh 32-byte salt, PBKDF2-HMAC-SHA256, 600k iterations.
 * Replaces any previous PIN and clears the attempt counter.
 *
 * The PIN is hashed natively and is not written to disk in any recoverable form.
 * @throws {SecureStoreUnavailableError}
 */
export async function setPin(pin: string): Promise<void> {
  if (!isValidPinFormat(pin)) {
    throw new Error(`PIN must be ${PIN_MIN_LENGTH} to ${PIN_MAX_LENGTH} digits`);
  }
  try {
    await requireBridge().setPin(pin);
  } catch (error) {
    return rethrow(error);
  }
}

/**
 * Checks a candidate PIN.
 *
 * A wrong PIN is counted natively (`recordPinFailure` is called inside
 * `verifyPin`), so this wrapper must NOT also call `recordPinFailure` - doing so
 * would double-advance the counter and double the delay.
 *
 * @throws {SecureStoreUnavailableError} when the verifier is incomplete, i.e. the
 * store is damaged. Deliberately not "no match": a damaged verifier must never
 * accept a PIN, and must never be cleared into a silently unlocked app.
 */
export async function verifyPin(pin: string): Promise<PinVerifyResult> {
  if (!isValidPinFormat(pin)) {
    throw new Error(`PIN must be ${PIN_MIN_LENGTH} to ${PIN_MAX_LENGTH} digits`);
  }
  try {
    const result = await requireBridge().verifyPin(pin);
    return {
      ok: result.ok === true,
      locked: result.locked === true,
      lockedUntil: typeof result.lockedUntil === 'number' ? result.lockedUntil : 0,
      attempts: typeof result.attempts === 'number' ? result.attempts : 0,
    };
  } catch (error) {
    return rethrow(error);
  }
}

/**
 * Current rate-limit state, for a countdown shown while the user waits.
 * @throws {SecureStoreUnavailableError}
 */
export async function getPinLockout(): Promise<PinLockoutState> {
  try {
    const state = await requireBridge().getPinLockout();
    return {
      attempts: typeof state.attempts === 'number' ? state.attempts : 0,
      lockedUntil: typeof state.lockedUntil === 'number' ? state.lockedUntil : 0,
      locked: state.locked === true,
    };
  } catch (error) {
    return rethrow(error);
  }
}

/**
 * Wipes the verifier, salt, iteration count, algorithm, stored length and the
 * attempt counter, leaving any other stored value alone.
 * @throws {SecureStoreUnavailableError}
 */
export async function clearPin(): Promise<void> {
  try {
    await requireBridge().clearPin();
  } catch (error) {
    return rethrow(error);
  }
}

/**
 * Deletes every caller key and every module-internal key, and wipes the backing
 * file - including the Convex session token.
 *
 * This is the "forgot everything" escape hatch. It is destructive of the session
 * by design, and callers are expected to sign out first so the server-side token
 * is revoked rather than orphaned.
 * @throws {SecureStoreUnavailableError}
 */
export async function clearAll(): Promise<void> {
  try {
    await requireBridge().clearAll();
  } catch (error) {
    return rethrow(error);
  }
}

// ------------------------------------------------------------------ lock config

/**
 * Reads the app-lock configuration.
 *
 * Encrypted store ONLY - no AsyncStorage fallback, deliberately. A fallback here
 * would mean a broken Keystore reads as "lock off", which is precisely the
 * bypass this whole design is arranged to prevent. The caller gets a throw and
 * shows the reset path.
 *
 * @throws {SecureStoreUnavailableError}
 */
export async function readLockConfig(): Promise<LockConfig> {
  const gate = requireBridge();
  let enabledRaw: string | null = null;
  let graceRaw: string | null = null;
  try {
    // Sequential rather than parallel: both reads go through one single-threaded
    // worker, so parallelising them would not overlap any real work.
    enabledRaw = await gate.getItem(LOCK_KEYS.enabled);
    graceRaw = await gate.getItem(LOCK_KEYS.graceMs);
  } catch (error) {
    return rethrow(error);
  }

  const grace = graceRaw === null ? NaN : Number(graceRaw);
  const graceMs =
    Number.isFinite(grace) &&
    APP_LOCK_GRACE_OPTIONS.some(option => option.ms === grace)
      ? grace
      : DEFAULT_LOCK_GRACE_MS;

  return { enabled: enabledRaw === 'true', graceMs };
}

/**
 * Persists the lock configuration.
 *
 * `enabled` is written only after the PIN verifier has been confirmed present
 * (see `enableAppLock`), so a crash between the two cannot leave the app claiming
 * a lock it has no PIN to enforce.
 * @throws {SecureStoreUnavailableError}
 */
export async function writeLockConfig(config: LockConfig): Promise<void> {
  const gate = requireBridge();
  try {
    await gate.setItem(LOCK_KEYS.enabled, config.enabled ? 'true' : 'false');
    await gate.setItem(LOCK_KEYS.graceMs, String(config.graceMs));
  } catch (error) {
    return rethrow(error);
  }
}

/**
 * A PLAINTEXT, non-sensitive marker recording that this install ever had the
 * app lock turned on.
 *
 * Why it exists. The security rule "an unreadable secure store is never
 * reported as 'lock off'" is correct for someone who HAS a lock - it stops a
 * broken keystore silently dropping the gate. But on a FRESH install where the
 * user never enabled the lock, the same rule bricks the app: the store throws,
 * the app concludes it must be locked, and shows a recovery-only screen with no
 * lock to recover from.
 *
 * This marker separates the two. It lives in ordinary AsyncStorage, so it is
 * readable exactly when the keystore is not. It holds no secret - just the fact
 * that a lock was configured - so writing it in the clear costs nothing.
 *
 * Set whenever the lock is enabled; cleared only on an explicit disable.
 */
const CONFIGURED_MARKER = 'synomilo.applock.configured';

export async function markAppLockConfigured(): Promise<void> {
  try {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage'))
      .default;
    await AsyncStorage.setItem(CONFIGURED_MARKER, 'true');
  } catch {
    // Best effort. Worst case is the conservative locked-by-default path.
  }
}

export async function wasAppLockEverConfigured(): Promise<boolean> {
  try {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage'))
      .default;
    return (await AsyncStorage.getItem(CONFIGURED_MARKER)) === 'true';
  } catch {
    // Cannot prove it was never configured, so assume the safe direction.
    return true;
  }
}

/**
 * Turns the lock on: the PIN first, then confirmation that it is really there,
 * then the flag. See `writeLockConfig` for why the order is what it is.
 * @throws {SecureStoreUnavailableError}
 */
export async function enableAppLock(
  pin: string,
  graceMs: number = DEFAULT_LOCK_GRACE_MS,
): Promise<void> {
  await setPin(pin);
  if (!(await hasPin())) {
    throw new Error('PIN verifier did not persist');
  }
  await writeLockConfig({ enabled: true, graceMs });
  // Written only AFTER the verifier and the flag are both confirmed, so the
  // marker can never claim a lock exists when none was ever set up.
  await markAppLockConfigured();
}

/**
 * Turns the lock off. The session token is untouched - turning off the lock must
 * not sign anyone out.
 * @throws {SecureStoreUnavailableError}
 */
export async function disableAppLock(): Promise<void> {
  const gate = requireBridge();
  try {
    await gate.clearPin();
    await gate.setItem(LOCK_KEYS.enabled, 'false');
  } catch (error) {
    return rethrow(error);
  }
}

/** Replaces the PIN on an already-enabled lock. @throws {SecureStoreUnavailableError} */
export async function changePin(pin: string): Promise<void> {
  await setPin(pin);
  if (!(await hasPin())) {
    throw new Error('PIN verifier did not persist');
  }
}

// ------------------------------------------------------------------ session token

/**
 * ------------------------------------------------------------------------
 * SESSION TOKEN MIGRATION
 * ------------------------------------------------------------------------
 *
 * Read order: encrypted store, then AsyncStorage, then migrate.
 *
 * The ordering is the security property:
 *
 *     1. Look in the encrypted store. A hit means migration already happened.
 *     2. On a miss, look in AsyncStorage. That is a pre-migration install.
 *     3. Write it to the encrypted store and READ IT BACK. Only a value that
 *        comes back identical counts as written - `SharedPreferences.apply()` is
 *        asynchronous, and a keystore write that silently did not land must not
 *        be treated as success.
 *     4. Only then delete the plaintext copy.
 *
 * Deleting before the read-back is the failure this is arranged to prevent: the
 * token would be gone from both stores and the user logged out with no way to tell
 * why. As written, the worst case is a failed migration that leaves a plaintext
 * copy behind - the pre-existing state - and never a lost session.
 *
 * FAILURE MODE, stated plainly: if the AndroidKeyStore entry is lost *after* a
 * successful migration - which in practice means the app's data directory was
 * restored onto a different device, since Keystore keys never leave the hardware
 * that made them - the encrypted store is unreadable, AsyncStorage is empty
 * because step 4 removed it, and the user is logged out. Re-authenticating is all
 * that is needed and nothing is locked; the session simply cannot be resumed.
 */

/** Reads a persisted value, migrating it out of plaintext on first sight. */
export async function readPersisted(key: string): Promise<string | null> {
  if (isSecureStoreSupported()) {
    try {
      const fromSecure = await secureGet(key);
      if (fromSecure !== null) {
        return fromSecure;
      }
    } catch {
      // Keystore unreadable. Fall through to plaintext - a re-login beats a
      // session that cannot be loaded, and the plaintext is still the truth.
      return AsyncStorage.getItem(key).catch(() => null);
    }
  }

  const legacy = await AsyncStorage.getItem(key).catch(() => null);
  if (legacy === null) {
    return null;
  }

  if (isSecureStoreSupported()) {
    try {
      await secureSet(key, legacy);
      const readBack = await secureGet(key);
      if (readBack === legacy) {
        // Verified. Now, and only now, the plaintext copy goes.
        await AsyncStorage.removeItem(key).catch(() => {});
      }
    } catch {
      // Migration failed; keep the plaintext copy. Not an error worth surfacing -
      // the session works exactly as it did before.
    }
  }

  return legacy;
}

/**
 * Writes a persisted value, preferring the encrypted store.
 *
 * Falls back to AsyncStorage when the encrypted write fails, because a session
 * that outlives a keystore problem is strictly better than no session.
 */
export async function writePersisted(entries: Record<string, string>): Promise<void> {
  if (isSecureStoreSupported()) {
    try {
      for (const [key, value] of Object.entries(entries)) {
        await secureSet(key, value);
      }
      return;
    } catch {
      // Fall through to plaintext.
    }
  }
  await AsyncStorage.multiSet(Object.entries(entries)).catch(() => {});
}

/** Removes persisted values from both stores. */
export async function removePersisted(keys: string[]): Promise<void> {
  if (isSecureStoreSupported()) {
    try {
      for (const key of keys) {
        await secureRemove(key);
      }
    } catch {
      // Nothing useful to do; the plaintext removal below still runs.
    }
  }
  await AsyncStorage.multiRemove(keys).catch(() => {});
}

/**
 * Best-effort check that the encrypted store is actually readable, used by the
 * lock screen to tell "lock is off" apart from "this device cannot read its own
 * secrets". Never throws.
 */
export async function probeSecureStore(): Promise<{
  supported: boolean;
  available: boolean;
  backend: string | null;
}> {
  if (!isSecureStoreSupported()) {
    return { supported: false, available: false, backend: null };
  }
  try {
    const info = await secureBackendInfo();
    return { supported: true, available: info.available, backend: info.backend };
  } catch {
    return { supported: true, available: false, backend: null };
  }
}