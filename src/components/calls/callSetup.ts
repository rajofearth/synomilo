/**
 * Pure helpers for call setup, kept out of the screen so they can be tested.
 *
 * Nothing in here touches a peer connection or React.
 *
 * The reason this file exists at all: `react-native-webrtc` silently drops the
 * `video` half of `getUserMedia` when the camera permission is not granted
 * (`node_modules/react-native-webrtc/src/getUserMedia.ts:71`,
 * `videoPerm || delete constraints.video`) and resolves with an audio-only
 * stream as though nothing had gone wrong. Nothing in the screen could see
 * that, because by the time the stream arrived the damage was invisible -
 * `getVideoTracks()` was empty and `toURL()` still returned a perfectly valid
 * URL, which the `RTCView` then mounted on and rendered nothing into.
 */

/** One entry of the list handed to `PermissionsAndroid.requestMultiple`. */
export interface PermissionRequest {
  permission: string;
  /** Human name for the message, e.g. `camera`. */
  label: string;
}

export interface PermissionSummary {
  granted: string[];
  /** User tapped "Don't allow" and would be asked again. */
  refused: string[];
  /** Turned off permanently; only Settings can change it. */
  blocked: string[];
}

const joinWords = (words: string[]): string => {
  if (words.length <= 1) {
    return words[0] ?? '';
  }
  if (words.length === 2) {
    return `${words[0]} and ${words[1]}`;
  }
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
};

/**
 * Turns `PermissionsAndroid.requestMultiple`'s result map into something the UI can
 * actually say. An undeclared permission comes back denied without any dialog ever
 * being shown, which used to be indistinguishable from success because the caller
 * threw the result away.
 */
export const summarisePermissionResults = (
  requests: PermissionRequest[],
  results: Record<string, string> | null | undefined,
): PermissionSummary => {
  const granted: string[] = [];
  const refused: string[] = [];
  const blocked: string[] = [];

  for (const { permission, label } of requests) {
    const result = results?.[permission];
    // `limited` is iOS' partial grant; the media it covers is usable, so counting
    // it as refused would be a lie.
    if (result === 'granted' || result === 'limited') {
      granted.push(label);
    } else if (result === 'never_ask_again') {
      blocked.push(label);
    } else {
      refused.push(label);
    }
  }

  return { granted, refused, blocked };
};

/**
 * A refusal has to be distinguishable from an outright failure to start the call,
 * because the two need different words: one is "you said no", the other is "turn it
 * on in Settings".
 *
 * Only trustworthy for a permission the APK actually declares. Telling someone to
 * go and allow a permission that is not in the manifest is advice that cannot
 * work, and Android offers them no such toggle - hence `missingVideoReason` for the
 * camera, which stays non-fatal.
 *
 * `video` matters more than `audio` here: without a microphone the call is
 * pointless and the screen says so up front.
 */
export const permissionFailureMessage = (
  summary: PermissionSummary,
): string | null => {
  const { refused, blocked } = summary;
  if (refused.length === 0 && blocked.length === 0) {
    return null;
  }
  if (blocked.length > 0) {
    const others = blocked.length > 1 ? ' are' : ' is';
    return `The ${joinWords(blocked)} permission${others} turned off. Turn it on in Settings → Apps → Synomilo → Permissions, then call again.`;
  }
  const verb = refused.length > 1 ? 'were' : 'was';
  return `The ${joinWords(refused)} permission ${verb} denied, so this call has no ${
    refused.includes('camera') ? 'picture' : 'sound'
  }. Allow it in Settings → Apps → Synomilo → Permissions.`;
};

/**
 * Why a video call has no outgoing picture, or null when it has one.
 *
 * The distinction the stream URL cannot make: an audio-only stream still has a URL,
 * so `RTCView` mounts happily and shows nothing. Saying *why* here is the only
 * thing that turns an empty grey box into a legible state.
 */
export const missingVideoReason = (
  summary: PermissionSummary,
  stream: any,
  wantsVideo: boolean,
): string | null => {
  if (!wantsVideo) {
    return null;
  }
  const count: number = stream?.getVideoTracks?.()?.length ?? 0;
  if (count > 0) {
    return null;
  }
  if (summary.blocked.includes('camera') || summary.refused.includes('camera')) {
    return 'No camera';
  }
  // Permission was granted but there is still no track: the camera is in use by
  // something else, or the device exposes none.
  return 'Camera unavailable';
};

/** What a track's state was at the moment we looked at it. */
export interface TrackEvidence {
  kind: string;
  id: string;
  readyState: string;
  enabled: boolean;
}

/**
 * The proof that a track is real and bound, rather than an assumption. Logged on
 * every call setup so "the box is empty" can be answered with data next time:
 * an audio-only stream is obvious here even though it looks fine from JS.
 */
export const describeLocalTracks = (stream: any): TrackEvidence[] => {
  const tracks: any[] = stream?.getTracks?.() ?? [];
  return tracks.map(track => ({
    kind: track.kind,
    id: track.id,
    readyState: track.readyState,
    enabled: track.enabled,
  }));
};

/**
 * The one line under the peer's name. `peerState`/`iceState` are the live
 * `RTCPeerConnection` values; before they existed the only thing the user could
 * read was "Ringing…", which is identical whether the call is about to connect or
 * is never going to.
 *
 * The timer is shown only once the peer connection is actually `connected`. The
 * server flips the row to `active` the moment it is accepted, which can be many
 * seconds before any media path exists - showing a running clock through that
 * window told the user a call was up when nothing had been negotiated.
 *
 * `linkPhase` is the caller's own view of the lifecycle ([advanceLink]). It is
 * optional so a caller that has no lifecycle state of its own still gets the
 * right answer from the raw peer-connection values.
 */
export const connectionStatusLabel = (args: {
  notice: string | null;
  callStatus: string | undefined;
  role: 'caller' | 'callee';
  peerState: string | null;
  iceState: string | null;
  elapsedLabel: string;
  linkPhase?: LinkPhase;
}): string => {
  const {
    notice,
    callStatus,
    role,
    peerState,
    iceState,
    elapsedLabel,
    linkPhase = 'connecting',
  } = args;

  if (notice) {
    return notice;
  }
  // Ahead of everything below, including a failed ICE state. A call that is being
  // recovered is not a call that failed, and saying "Connection failed" during a
  // handover that is about to succeed is the difference between a blip and a
  // hangup from the user's point of view.
  if (linkPhase === 'recovering') {
    return 'Reconnecting…';
  }
  // ICE is the layer that actually fails to come up. `connectionState` alone can sit
  // on 'new' indefinitely while ICE is already dead.
  if (iceState === 'failed') {
    return 'Connection failed';
  }
  if (peerState === 'failed' || peerState === 'closed') {
    return 'Connection failed';
  }
  // Checked before the `active` branch: a live call whose media path blipped is
  // "Reconnecting…", and reading it as still-connecting would send the user back
  // to watching a timer that is not going anywhere.
  if (peerState === 'disconnected') {
    return 'Reconnecting…';
  }
  if (callStatus === 'active') {
    return peerState === 'connected' ? elapsedLabel : 'Connecting…';
  }
  if (callStatus === 'ringing') {
    return role === 'caller' ? 'Ringing…' : 'Connecting…';
  }
  return 'Connecting…';
};

// ---------------------------------------------------------------------------
// Connection lifecycle
// ---------------------------------------------------------------------------

/**
 * How long an answered call has to come up before the first recovery attempt.
 *
 * Bounded because `connectionState` reaching `failed` takes tens of seconds on a
 * mobile network, so a call that was never going to connect would otherwise sit on
 * "Connecting…" indefinitely with no explanation and no way out but the hang-up
 * button.
 */
export const CONNECT_TIMEOUT_MS = 25000;

/**
 * How long each recovery attempt is given.
 *
 * A Wi-Fi->LTE handover re-keys in a couple of seconds and a lift usually clears
 * inside ten; 20s is generous without being the point at which the user assumes
 * the app has hung. Two of them is 40s of grace on a working call, which is the
 * difference between "smooth" and "it just died".
 */
export const RECOVERY_WINDOW_MS = 20000;

/**
 * ICE restarts per outage. Bounded so a call that cannot be saved does not sit
 * there for ever being politely knocked over.
 */
export const MAX_RECOVERY_ATTEMPTS = 2;

/** What the user is told when a call that was working could not be recovered. */
export const RECOVERY_GAVE_UP_REASON = 'Call lost · could not reconnect';

/** What the user is told when a call never carried media at all. */
export const CONNECT_FAILED_REASON = 'Connection failed';

export type LinkPhase =
  /** Never carried media yet; the establishing window governs. */
  | 'connecting'
  /** Up. No deadline is armed, by construction. */
  | 'connected'
  /** Dropped; being given a recovery window and an ICE restart. */
  | 'recovering'
  /** Terminal. The effect below has already been reported to the peer. */
  | 'failed';

export interface LinkState {
  phase: LinkPhase;
  /**
   * Local `Date.now()` at which the current phase's window was armed, or null
   * when no window is running. Re-armed on every phase entry, which is the whole
   * point: the previous implementation armed one instant when the call row
   * flipped to `active` and let it run for the life of the call.
   */
  armedAt: number | null;
  /** ICE restarts spent in the current outage. Cleared by a real recovery. */
  attempts: number;
  /** True once this call has actually carried media. */
  everConnected: boolean;
  /**
   * Identity of the device's default network as last observed, or null when it is
   * offline. From `CallNetworkModule`'s ConnectivityManager callback, which reports
   * the identity of the network *currently* in force rather than one callback's own
   * network, so a handover arriving as `onAvailable(new)` then `onLost(old)` is one
   * change and not two.
   */
  networkKey: string | null;
  /**
   * True once at least one network observation has been folded in.
   *
   * Separate from `networkKey` because null is a real observation ("no network")
   * and must be distinguishable from "nothing has told us yet". Without it the very
   * first observation would read as a handover and spend an ICE restart immediately,
   * on candidates that had just been gathered on that network.
   */
  networkObserved: boolean;
}

export type LinkEffect =
  | { type: 'none' }
  | { type: 'restartIce' }
  | { type: 'hangUp'; reason: string };

export interface LinkResult {
  state: LinkState;
  effect: LinkEffect;
}

const NO_EFFECT: LinkEffect = { type: 'none' };

/** ICE states that mean media is flowing. */
const ICE_UP = ['connected', 'completed'];

export const initialLinkState = (armedAt: number | null = null): LinkState => ({
  phase: 'connecting',
  armedAt,
  attempts: 0,
  everConnected: false,
  networkKey: null,
  networkObserved: false,
});

const linkIsUp = (peerState: string | null, iceState: string | null): boolean =>
  peerState === 'connected' || ICE_UP.includes(iceState ?? '');

const giveUp = (prev: LinkState): LinkResult => ({
  state: {
    phase: 'failed',
    armedAt: null,
    attempts: prev.attempts,
    everConnected: prev.everConnected,
    networkKey: prev.networkKey,
    networkObserved: prev.networkObserved,
  },
  effect: {
    type: 'hangUp',
    reason: prev.everConnected ? RECOVERY_GAVE_UP_REASON : CONNECT_FAILED_REASON,
  },
});

/**
 * Enter (or re-enter) recovery: spend an attempt, arm a fresh window measured
 * from *now*, and ask for an ICE restart. Gives up instead when the budget is
 * spent, which is the only place a hangup is ever emitted.
 *
 * Every route into recovery - the establishing deadline, a dropped connection, a
 * failed ICE layer, and a network handover - funnels through here, so all of them
 * share one attempt budget and one expiry. That is what stops a phone that keeps
 * changing network from being knocked over politely for ever.
 */
const beginRecovery = (prev: LinkState, now: number): LinkResult => {
  const attempts = prev.attempts + 1;
  if (attempts > MAX_RECOVERY_ATTEMPTS) {
    return giveUp(prev);
  }
  return {
    state: {
      phase: 'recovering',
      armedAt: now,
      attempts,
      everConnected: prev.everConnected,
      networkKey: prev.networkKey,
      networkObserved: prev.networkObserved,
    },
    effect: { type: 'restartIce' },
  };
};

/**
 * One tick of the connection lifecycle. Pure: it takes the state and the live
 * peer-connection values, and returns the next state plus at most one thing to do.
 *
 * The design in one sentence: **a deadline is armed on entry to a phase and
 * cleared on success, so a clock can only ever expire a phase it belongs to.**
 * The previous version armed one deadline when the call row flipped to `active`
 * and treated every non-`connected` value as "never going to connect", so a
 * ten-minute-old call that dropped on a network handover was hung up with
 * "Connection failed" on the next tick. Nothing here can do that: reaching
 * `connected` clears `armedAt`, and a call that has been connected gets a
 * recovery window rather than a verdict.
 *
 * `networkKey` is the other input. See [LinkState.networkKey]: this library gathers
 * candidates once, so a handover invalidates every candidate both sides hold, and
 * waiting for ICE to notice costs the whole consent-freshness window - tens of
 * seconds of silence - before the same recovery starts anyway. A changed network is
 * therefore treated as a recovery trigger in its own right.
 */
export const advanceLink = (
  prev: LinkState,
  input: {
    peerState: string | null;
    iceState: string | null;
    now: number;
    /** Default network identity, or null when offline. Omitted means "no news". */
    networkKey?: string | null;
  },
): LinkResult => {
  const { peerState, iceState, now } = input;

  // Terminal. Answering the same question again is how a call tells the peer it
  // ended twice, and a second `calls.end` also cancels a notification that may
  // since have been reused.
  if (prev.phase === 'failed') {
    return { state: prev, effect: NO_EFFECT };
  }

  /**
   * Fold the observation in and decide whether it was a *change*.
   *
   * `undefined` - the key is absent - means the caller has no network news this
   * tick, and is kept distinct from `null`, which is real news meaning "no
   * network". Collapsing the two would make the first observation of a perfectly
   * ordinary Wi-Fi connection read as a handover, and spend an ICE restart
   * immediately after the candidates had been gathered on it.
   *
   * Recording is otherwise unconditional, which is what makes the trigger
   * one-shot: the next tick compares against the network just stored.
   */
  const networkKey = input.networkKey ?? null;
  const observed =
    input.networkKey === undefined
      ? { ...prev }
      : { ...prev, networkKey, networkObserved: true };
  const handover =
    input.networkKey !== undefined &&
    prev.networkObserved &&
    prev.networkKey !== networkKey;

  // `closed` is this side tearing the peer connection down, which is a hangup
  // rather than a network problem.
  if (peerState === 'closed') {
    return giveUp(observed);
  }

  // A handover is worth an ICE restart while the call is connected, and equally
  // while it is still establishing - mid-handshake the candidates just gathered are
  // the ones that just died. Asked before the `connected` shortcut below because at
  // this instant the peer connection is still reporting the path it had before.
  //
  // The cost when the connection genuinely survived the swap is one restart and the
  // second or two it takes to come back; the cost of not asking is ICE's own
  // consent-freshness timeout, which is the silent dead-air this whole ladder
  // exists to shorten. Bounded either way: this goes through `beginRecovery`, so it
  // spends from the same attempt budget as everything else.
  if (handover) {
    return beginRecovery(observed, now);
  }

  // Up. The only place `attempts` is cleared, which is why a call that recovered
  // twice and then dropped an hour later still gets a full window rather than the
  // leftovers of the last outage.
  if (linkIsUp(peerState, iceState)) {
    if (prev.phase === 'connected') {
      return { state: observed, effect: NO_EFFECT };
    }
    return {
      state: {
        phase: 'connected',
        armedAt: null,
        attempts: 0,
        everConnected: true,
        // Carried over from `observed` rather than rebuilt. Rebuilding here is how
        // "connected" came to claim a network had been observed when none had: the
        // first real report then read as a handover and restarted a call whose
        // candidates had just been gathered on that very network.
        networkKey: observed.networkKey,
        networkObserved: observed.networkObserved,
      },
      effect: NO_EFFECT,
    };
  }

  const hardFailed = peerState === 'failed' || iceState === 'failed';
  const wasUpAndIsNotAnyMore = prev.phase === 'connected';

  // A recovery window is governed by the window alone. Re-entering recovery on
  // every repeated `disconnected`/`failed` signal is what would make the deadline
  // unexpirable, so those signals are ignored until the window has actually run
  // out - which is what lets a handover that takes 15 seconds be waited out
  // instead of being restarted from scratch on every tick.
  if (prev.phase === 'recovering') {
    if (prev.armedAt !== null && now - prev.armedAt >= RECOVERY_WINDOW_MS) {
      return beginRecovery(observed, now);
    }
    return { state: observed, effect: NO_EFFECT };
  }

  if (hardFailed || wasUpAndIsNotAnyMore) {
    return beginRecovery(observed, now);
  }

  // Establishing. Nothing has gone wrong, so the only thing that can end this
  // phase is the clock.
  if (prev.armedAt === null) {
    return { state: observed, effect: NO_EFFECT };
  }
  if (now - prev.armedAt < CONNECT_TIMEOUT_MS) {
    return { state: observed, effect: NO_EFFECT };
  }
  return beginRecovery(observed, now);
};

/**
 * Whether an ICE restart can actually be attempted on this peer connection right
 * now.
 *
 * Verified against this `react-native-webrtc`, not assumed:
 *
 *  - `restartIce()` exists - `src/RTCPeerConnection.ts:561` - and is not a no-op;
 *    it reaches `WebRTCModule.peerConnectionRestartIce(pcId)`, which is
 *    `org.webrtc.PeerConnection.restartIce()` on Android
 *    (`WebRTCModule.java:1347`).
 *  - But libwebrtc performs the restart on the *next* local description, so
 *    `restartIce()` alone produces no candidates: with `continualGatheringPolicy`
 *    unavailable in 124's `RTCConfiguration` (`src/RTCPeerConnection.ts:56-62`),
 *    gathering is `gather_once`, and `restartIce()` sets the flag that
 *    `createOffer({ iceRestart: true })` consumes. So a restart has to be followed
 *    by a fresh offer, which needs a remote description to restart on top of.
 *  - `signalingState === 'stable'` because a restart offer issued while this side
 *    already has a local offer out is glare, and this pipeline's fixed
 *    caller-offers / callee-answers roles mean the peer would answer the wrong one.
 */
export const canRestartIce = (pc: any): boolean =>
  !!pc &&
  typeof pc.restartIce === 'function' &&
  pc.signalingState === 'stable' &&
  !!pc.remoteDescription;