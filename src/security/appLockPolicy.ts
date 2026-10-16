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
 *
 * PURELY THE SIGNAL. Nothing in this function reads a timestamp or a latch, and
 * that is the whole point: it answers "is a call in the picture right now", which
 * is a question about observable state. The one exception - the navigation gap
 * before `screenVisible` is set - is not answered here. It is answered exactly
 * once, by `claimCallHandOff`, because that gap belongs to the *episode* that is
 * being armed inside it and to nothing else. See the hand-off section below.
 */
export function callInterruptsLock(signal: CallSignal): boolean {
  return signal.connected || signal.ringing || signal.callScreenVisible;
}

/** The subset that is allowed to bring an already-armed gate down. */
export function callReleasesGate(signal: CallSignal): boolean {
  // Accepting a call stands the lock down: the user has already proved who they
  // are by getting to the app to answer it. Re-arming them on the call screen
  // would be the "it asks me for my biometric pin again" complaint.
  return signal.connected || signal.callScreenVisible;
}

/**
 * ------------------------------------------------------------------------
 * THE CALL HAND-OFF
 * ------------------------------------------------------------------------
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
 * decides to navigate, and `AppLock` claims it when it arms.
 *
 * ------------------------------------------------------------------------
 * WHY IT IS CLAIMED ONCE AND NOT POLLED
 * ------------------------------------------------------------------------
 * This used to be a free-running window that three different decisions
 * (`callInterruptsLock`, `callReleasesGate` and the auto-prompt effect) each
 * consulted on their own schedule. That is what made the reported bug possible:
 * a stamp taken on an ordinary foreground was still true when the gate armed, so
 * the gate stood itself down and the fingerprint prompt never appeared - not on
 * open, not on resume, ever. A latch that three unrelated readers can each act
 * on is not a hand-off any more; it is a global mute with a five second timeout.
 *
 * So the fact is *claimed*, once, by the single decision it actually bears on:
 * the arming of a lock episode. `claimCallHandOff()` answers "is this episode
 * being armed inside a call navigation?" and then refuses to answer again until
 * a new hand-off is noted. Consequences, all of them intended:
 *
 *   - One real `openCallScreen` can suppress exactly one lock episode.
 *   - A second arming, a second resume, or any later open is judged on the
 *     observable call signal alone.
 *   - A stamp that is never claimed simply expires.
 */
let callHandOffAt = 0;
let callHandOffClaimed = false;

/**
 * How long a hand-off keeps being claimable. Deliberately short: it only has to
 * outlast the navigation gap between "the user accepted" and
 * `callScreenVisible` becoming true, which is a few hundred milliseconds. A long
 * window would widen the blast radius of a mis-placed `noteCallHandOff()`.
 */
const HAND_OFF_WINDOW_MS = 5_000;

/**
 * Record that the user has just accepted a call and is being moved to the call
 * screen. Call this from the one place that navigates there, before `navigate()`.
 *
 * One site only. It means "a call is involved", and putting it on any general
 * foreground handler turns the lock off for everybody - which is exactly the
 * regression that made the fingerprint prompt stop appearing on every ordinary
 * open.
 *
 * The stamp alone suppresses nothing. `claimCallHandOff` is the only reader, it
 * runs once per arming, and the episode it arms gives up its exemption after
 * `CALL_BORN_PROMPT_GRACE_MS` whether or not a call ever shows up.
 */
export function noteCallHandOff(): void {
  callHandOffAt = Date.now();
  callHandOffClaimed = false;
}

/**
 * True exactly once per hand-off, and only while the hand-off is fresh.
 *
 * The caller is `armLock`, so the answer is "this episode began inside a call
 * navigation" - and it can only ever be true of one episode.
 */
export function claimCallHandOff(now: number = Date.now()): boolean {
  if (
    callHandOffClaimed ||
    callHandOffAt === 0 ||
    now - callHandOffAt >= HAND_OFF_WINDOW_MS
  ) {
    return false;
  }
  callHandOffClaimed = true;
  return true;
}

/**
 * ------------------------------------------------------------------------
 * HOW LONG A CALL-BORN EPISODE MAY GO WITHOUT A PROMPT
 * ------------------------------------------------------------------------
 *
 * A call-born episode is one that `armLock` began inside a call navigation. It
 * owes no prompt, because the call is about to take the screen and
 * `callReleasesGate` will stand the gate down.
 *
 * That is a promise about something that has not happened yet, so it needs a
 * deadline. If the navigation fails, the call is dropped in the gap, or the
 * accept was for a call that is already over, nothing arrives to release the
 * gate - and an episode that is quietly exempt from the one thing every other
 * episode gets is exactly how a lock ends up armed with no way through it.
 *
 * Three seconds is an order of magnitude more than the gap it has to cover (a
 * Convex round trip plus a navigation plus a screen mount is a few hundred
 * milliseconds) and an order of magnitude less than the grace periods this app
 * offers, so the user is never left waiting on a clock they cannot see. The
 * PIN pad is on screen for the whole of it, so the deadline is a ceiling on the
 * awkwardness, not on their ability to get in.
 */
export const CALL_BORN_PROMPT_GRACE_MS = 3_000;

/**
 * Whether an episode that was armed inside a call navigation may still decline
 * to present a prompt.
 *
 * The single reader of `callBornEpisode`, so the deadline cannot be applied
 * inconsistently by the auto-prompt effect and the render.
 */
export function callBornMayWithholdPrompt(args: {
  bornEpisode: number;
  episode: number;
  bornAt: number;
  now?: number;
}): boolean {
  if (args.bornEpisode !== args.episode || args.bornEpisode < 0) {
    return false;
  }
  return (args.now ?? Date.now()) - args.bornAt < CALL_BORN_PROMPT_GRACE_MS;
}

/**
 * ------------------------------------------------------------------------
 * THE WAY-FORWARD INVARIANT
 * ------------------------------------------------------------------------
 *
 * What an armed gate is offering, as a value, so the render cannot answer the
 * question by re-deriving it three different ways.
 *
 * There are exactly three answers and no fourth. This exists because the
 * question used to be asked twice with two different expressions - once in the
 * component body as `!biometricAvailable`, once in the auto-prompt effect as
 * `callInterruptsLock` - and the space between those two answers is where "the
 * gate came up and offered nothing" lived.
 *
 * `recovery` is not a failure state: it is the state that renders the
 * unconditional sign-out-and-reset control, which is why an install with no
 * usable verifier is still escapable.
 */
export type GateSurface = 'prompt' | 'pinPad' | 'recovery';

export function resolveGateSurface(args: {
  /** The OS dialog is up right now, or is about to be. */
  promptShowing: boolean;
  /** A verifier was read out of the store and is therefore enterable. */
  pinUsable: boolean;
}): GateSurface {
  if (args.promptShowing) {
    return 'prompt';
  }
  return args.pinUsable ? 'pinPad' : 'recovery';
}

/**
 * ------------------------------------------------------------------------
 * WHAT THE LOCK ROW IS ALLOWED TO SAY
 * ------------------------------------------------------------------------
 *
 * Settings and Profile each describe the lock in their own words, and the gate
 * decides for itself. Nothing stopped the three from disagreeing, and two
 * documented states make them: a platform with no encrypted store (Settings
 * said "not available", Profile said "Off") and a lock that is on with no
 * verifier behind it (both said "PIN only", which is a promise of a keypad that
 * is not there).
 *
 * This is the one description, derived from the one store, so that a row
 * saying "on" is a statement about what the gate will actually do.
 */
export type LockStatusSummary = {
  /** Whether the gate will come up on the next foreground. */
  willLock: boolean;
  /** Whether the gate can only be left by signing out. */
  needsReset: boolean;
  /** Copy for a settings row. Never mentions a fallback that is not there. */
  label: string;
};

export function summarizeLockState(state: {
  status: 'unsupported' | 'unknown' | 'ready' | 'storeBroken';
  enabled: boolean;
  pinSet: boolean;
  biometricsAvailable: boolean;
}): LockStatusSummary {
  if (state.status === 'unknown') {
    return { willLock: false, needsReset: false, label: 'Checking…' };
  }
  if (state.status === 'unsupported') {
    return { willLock: false, needsReset: false, label: 'Not available on this device' };
  }
  if (state.status === 'storeBroken') {
    // `willLock` is true: this is the fail-closed branch, and the row must not
    // describe it as anything softer.
    return {
      willLock: true,
      needsReset: true,
      label: 'On, but this device can no longer read its secure storage',
    };
  }
  if (!state.enabled) {
    return { willLock: false, needsReset: false, label: 'Off' };
  }
  if (!state.pinSet) {
    // On, with nothing to enter. The gate still comes up, and the only way out
    // is the reset control - so the row says exactly that.
    return {
      willLock: true,
      needsReset: true,
      label: 'On, but there is no PIN stored - reset required to get in',
    };
  }
  if (state.biometricsAvailable) {
    return {
      willLock: true,
      needsReset: false,
      label: 'On, biometrics with a PIN fallback',
    };
  }
  return { willLock: true, needsReset: false, label: 'On, PIN only' };
}
