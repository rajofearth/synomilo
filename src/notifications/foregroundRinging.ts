import { NativeModules } from 'react-native';

/**
 * ------------------------------------------------------------------------
 * WHO RINGS, AND WHERE
 * ------------------------------------------------------------------------
 *
 * An incoming call has exactly ONE sound source at any instant, and which one
 * that is depends only on whether anybody can see the app:
 *
 *   FOREGROUND  `IncomingCallOverlay` (this module's native bridge).
 *   BACKGROUND  the ringing notification channel, `incoming_call_v5`.
 *   KILLED      the ringing notification channel, `incoming_call_v5`.
 *
 * v1.1.3 collapsed these into "the channel is the single owner of the sound,
 * in every state". That is the change that produced "a call arrives while the
 * app is open, the overlay appears, and the ringtone and the vibration both
 * stop while the call is still ringing". The overlay had no sound of its own,
 * so every teardown that cancelled the notification - accept, decline, or the
 * stale-ring reconcile that runs on an unrelated re-render - removed the only
 * source and left the user looking at a silent call.
 *
 * The rule that makes this file necessary rather than merely tidy: the overlay
 * must be able to RING on its own, because the moment it is on screen it must
 * cancel the notification (two rings at once is worse than none). Ownership is
 * therefore not "who posted the notification", it is "who is on screen".
 *
 * `IncomingCallOverlay` is the only caller. It hands the ring back and forth
 * across an AppState change; see [handRingToNotification] for why that handover
 * is not optional.
 */

/**
 * The native half, `CallAudioModule.kt`.
 *
 * Deliberately narrow: `start`/`stop` take a callId and nothing else, so this
 * module can never grow enough state to disagree with the platform about what
 * is ringing. The callId exists purely so a late `stop` for a call the user has
 * already answered cannot silence the NEXT call.
 */
export interface CallAudioRingBridge {
  start?: (callId: string) => Promise<boolean>;
  stop?: (callId: string) => Promise<boolean>;
}

/**
 * Read at call time, never at module load.
 *
 * `NativeModules` is populated during bridge startup and the tests install a
 * stub in `beforeEach`, long after this module has been imported. A module-scope
 * `const bridge = NativeModules.CallAudio` would capture `undefined` forever and
 * every ring would be silently a no-op - which is the exact failure this whole
 * change exists to remove.
 */
const bridge = (): CallAudioRingBridge | undefined =>
  NativeModules.CallAudio as CallAudioRingBridge | undefined;

/**
 * The call this process is ringing for, or null.
 *
 * Module scope on purpose. The owner of a ring outlives the React tree that
 * started it - the overlay unmounts on sign-out and on a re-mount, and an
 * unmount that cannot prove it owned the sound must not be trusted to have
 * stopped it. This is the single place that knows.
 */
let activeCallId: string | null = null;

/**
 * Android-only in practice, because the bridge is a Kotlin module - but not
 * Android-gated in JS. "Is there a bridge to drive" is the honest question, and
 * the native side answers it: on a platform without the module every entry point
 * below resolves false rather than throwing, so this degrades to "no foreground
 * ring" instead of crashing a call screen. A `Platform.OS` check here would be a
 * second source of truth about the same fact, and one that goes stale the day the
 * ring is ported.
 */
export const IncomingCallRingBridge = {
  /**
   * Start ringing for `callId`, replacing any ring already in progress.
   *
   * Idempotent for the same call: a re-render that re-runs the caller's effect
   * must not restart the ringtone from bar one, which reads as a stutter and
   * restarts the vibration pattern.
   */
  async start(callId: string): Promise<boolean> {
    if (!callId) {
      return false;
    }
    if (activeCallId === callId) {
      return true;
    }
    const native = bridge();
    if (!native?.start) {
      return false;
    }
    if (activeCallId !== null) {
      await IncomingCallRingBridge.stop(activeCallId);
    }
    try {
      const started = await native.start(callId);
      activeCallId = started ? callId : null;
      return started === true;
    } catch (error) {
      console.log('[ring] foreground ring could not start', error);
      activeCallId = null;
      return false;
    }
  },

  /**
   * Stop ringing.
   *
   * The `activeCallId` guard is load-bearing, not defensive: accept, decline and
   * the unmount cleanup all converge here, and without it the native module
   * would be told to stop three times for one ring. Worse, an unmount that races
   * a *different* call arriving would stop that call's ring instead.
   */
  async stop(callId: string): Promise<boolean> {
    const owned = activeCallId;
    activeCallId = null;
    if (!owned || owned !== callId) {
      return false;
    }
    const native = bridge();
    if (!native?.stop) {
      return false;
    }
    try {
      return (await native.stop(callId)) === true;
    } catch (error) {
      console.log('[ring] foreground ring could not stop', error);
      return false;
    }
  },

  /** The call this process is ringing for, or null. Read-only for callers. */
  activeCallId: (): string | null => activeCallId,
};

/** True while this process owns the ring, whatever that ring is. */
export const foregroundRingingActive = (): boolean => activeCallId !== null;
