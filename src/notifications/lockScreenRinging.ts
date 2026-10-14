import { NativeModules, Platform } from 'react-native';

interface CallIntentBridge {
  canRingOverLockScreen?: () => Promise<boolean>;
  requestRingOverLockScreen?: () => Promise<boolean>;
}

const bridge = (): CallIntentBridge | undefined =>
  NativeModules.CallIntent as CallIntentBridge | undefined;

/**
 * Whether an incoming call will actually be able to take over a locked screen.
 *
 * Below Android 14 this is always true - `USE_FULL_SCREEN_INTENT` was an ordinary
 * permission and the system honoured it. From Android 14 it became special app
 * access: a non-calling app has its full-screen intents blocked by default, and
 * the system silently downgrades a ringing notification to a heads-up. The user
 * has to grant "Full screen notifications" once, in system settings.
 *
 * The app is not the default dialer, so `MANAGE_OWN_CALLS` alone does not buy
 * this - the grant is required. Which means: on Android 14+ this can be false on
 * a perfectly correctly configured app, and the symptom is "calls don't come
 * through when the phone is locked" with nothing anywhere explaining why.
 */
export async function canRingOverLockScreen(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return true;
  }
  try {
    return (await bridge()?.canRingOverLockScreen?.()) ?? true;
  } catch {
    return true;
  }
}

/**
 * Open the "Full screen notifications" system screen so the user can grant it.
 * Returns false on platforms where the grant is not needed or cannot be made.
 */
export async function requestRingOverLockScreen(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return false;
  }
  try {
    return (await bridge()?.requestRingOverLockScreen?.()) ?? false;
  } catch {
    return false;
  }
}