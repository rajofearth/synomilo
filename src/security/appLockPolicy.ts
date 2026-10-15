/**
 * The two contested decisions the app lock makes, as pure functions.
 *
 * ------------------------------------------------------------------------
 * WHY THESE ARE NOT IN THE COMPONENT
 * ------------------------------------------------------------------------
 * Both of them are the kind of decision that fails quietly. A prompt that
 * re-presents itself does not throw, it just annoys; a lock that covers a call
 * does not throw either, it just loses the call. Keeping them here means the
 * rule is stated once, in a form that can be read (and reasoned about) without
 * a React renderer, a theme and a session in the way.
 *
 * Nothing here reaches for React, the bridge or the store. That is the point.
 */

/**
 * Per-episode state that decides whether the OS prompt may be presented.
 *
 * The unit of the guard is an *episode*, not "is a prompt showing". A prompt
 * showing right now says nothing about whether one was already shown and
 * dismissed two seconds ago, and that second question is the one that produces
 * the double prompt.
 */
export type PromptAdmission = {
  /**
   * Increments every time the gate is armed. `armLock` is the only thing that
   * may bump it, which is what makes "once per episode" enforceable at all.
   */
  episode: number;
  /**
   * The episode whose prompt has already been presented, or -1 if none has.
   *
   * A single int rather than a boolean on purpose: `armLock` has to be able to
   * re-arm *and* stay locked, and a boolean would have to be cleared to
   * re-arm, which is exactly the moment a second prompt becomes possible.
   */
  presentedEpisode: number;
  /** A prompt is awaiting its result right now. */
  presenting: boolean;
  /**
   * `AppState.currentState === 'active'`.
   *
   * Required, because the native module needs a RESUMED `FragmentActivity` and
   * answers anything less with a rejection. Asking anyway produces the
   * "screen changed before the fingerprint check could open" message and a
   * dead-end screen the user has to press a second button to escape.
   */
  appActive: boolean;
  /** Milliseconds of OS backoff still running. */
  cooldownRemainingMs: number;
};

/**
 * Whether the automatic biometric prompt may be presented *now*.
 *
 * Four independent conditions, each of which exists because its absence caused
 * a specific reported symptom:
 *
 *   - `appActive`          - the prompt is refused by a non-resumed activity.
 *   - `presenting`         - a second prompt over the first.
 *   - `presentedEpisode`   - the prompt already ran in this lock episode and the
 *                            app came back around (including because the prompt
 *                            itself dipped the app out of foreground).
 *   - `cooldownRemainingMs`- Android's own 30s backoff, where any prompt can
 *                            only fail and every failure reads as "broken".
 */
export function mayPresentPrompt(state: PromptAdmission): boolean {
  if (!state.appActive || state.presenting) {
    return false;
  }
  if (state.presentedEpisode === state.episode) {
    return false;
  }
  return state.cooldownRemainingMs <= 0;
}

/**
 * What the lock can observe about a call, from outside the call feature.
 *
 * Three signals rather than one, because they cover three different instants
 * and each of the others has a window the remaining one does not:
 *
 *   - `connected`          - `useCallStore.active`. True once the callee is on.
 *   - `ringing`            - `api.calls.incoming`. True while the server still
 *                            considers the call unanswered, which covers the
 *                            resume that *is* the accept.
 *   - `callScreenVisible`  - `useCallStore.screenVisible`. True from the moment
 *                            navigation lands, which is earlier than `connected`
 *                            and is the only signal that covers a cold start
 *                            launched by the accept itself.
 */
export type CallSignal = {
  connected: boolean;
  ringing: boolean;
  callScreenVisible: boolean;
};

/**
 * Whether a call is ringing, being answered, or live - and so whether the gate
 * must get out of the way.
 *
 * `connected || callScreenVisible` releases an armed gate. `ringing` on its own
 * deliberately does not: a ringing call is answered from the native ring
 * activity, which draws over this screen, so there is no reason to hand the
 * conversation to anyone the caller can reach. `ringing` exists here for the
 * *resume* decision, where it is the difference between "the user came back to
 * answer a call" and "the user came back to read messages".
 */
export function callInterruptsLock(signal: CallSignal): boolean {
  // A hand-off in progress is the caller saying "the user just answered, I am
  // navigating now". React state has not caught up yet, so `signal` can still say
  // nothing is happening while a prompt is about to be scheduled. Trusting the
  // stamp is what stops the dialog flashing over the call being answered.
  return (
    signal.connected ||
    signal.ringing ||
    signal.callScreenVisible ||
    isCallHandOffRecent()
  );
}

/** The subset that is allowed to bring an already-armed gate down. */
export function callReleasesGate(signal: CallSignal): boolean {
  // Accepting a call stands the lock down: the user has already proved who they
  // are by getting to the app to answer it. Re-arming them on the call screen
  // would be the "it asks me for my biometric pin again" complaint.
  return (
    signal.connected || signal.callScreenVisible || isCallHandOffRecent()
  );
}
/**
 * WHY A MODULE-LEVEL LATCH AND NOT ANOTHER PROP
 *
 * Accepting an incoming call can land on the call screen before any React state
 * says so. `callReleasesGate` needs `callScreenVisible`, which `AppLock` reads
 * from the call store; but navigation is asynchronous, and on a cold start
 * launched by the accept itself the gate mounts, arms and schedules its prompt
 * timer before `screenVisible` ever flips. That gap is roughly 200 ms and the
 * user sees a fingerprint prompt flash over the call they just answered - the
 * exact complaint that produced this module.
 *
 * Propagating a signal through props cannot close that gap, because both sides
 * are reacting to the same event and neither has run yet. A `Date.now()` stamp in
 * module scope can: `App.tsx` marks the hand-off synchronously at the moment it
 * decides to navigate, and `AppLock` reads it when it decides whether to spend an
 * episode. Ordering is then guaranteed rather than merely likely.
 */
let callHandOffAt = 0;

/**
 * How long a hand-off keeps suppressing the prompt. Deliberately short: it only
 * has to outlast the navigation gap between "the user accepted" and
 * `callScreenVisible` becoming true, which is a few hundred milliseconds. A long
 * window would be a silent security hole - abandoning the call screen mid-gap
 * would leave the lock disarmed for as long as the window lasted.
 */
const HAND_OFF_WINDOW_MS = 5_000;

/**
 * Record that the user has just accepted a call and is being moved to the call
 * screen. Call this from the one place that navigates there, before `navigate()`.
 */
export function noteCallHandOff(): void {
  callHandOffAt = Date.now();
}

/**
 * True while a call hand-off is still in progress. Bounded rather than sticky: a
 * call that was abandoned in the navigation gap must not disable the lock for
 * the rest of the session, so the latch expires.
 */
export function isCallHandOffRecent(windowMs = HAND_OFF_WINDOW_MS): boolean {
  return callHandOffAt > 0 && Date.now() - callHandOffAt < windowMs;
}
