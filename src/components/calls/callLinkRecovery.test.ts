/**
 * The connection lifecycle: a deadline that bounds *establishing* a call, and a
 * bounded recovery ladder for a call that was working and then dropped.
 *
 * Every test here is a regression test for a real, reproducible failure:
 *
 *   - A single 25s deadline armed when the call row flipped to `active` ran for
 *     the life of the call, and every non-`connected` state counted as "never
 *     going to connect". A ten-minute-old call that dropped on a Wi-Fi->LTE
 *     handover was hung up with "Connection failed" inside one second.
 *   - There was no recovery at all: `disconnected` was a label, not a behaviour.
 *     No ICE restart, and `gather_once` gathering (this `react-native-webrtc`
 *     does not expose `continualGatheringPolicy`) meant no new candidates were
 *     ever produced after setup.
 */

import {
  advanceLink,
  canRestartIce,
  connectionStatusLabel,
  CONNECT_TIMEOUT_MS,
  initialLinkState,
  MAX_RECOVERY_ATTEMPTS,
  RECOVERY_WINDOW_MS,
  type LinkEffect,
  type LinkState,
} from './callSetup';

const T0 = 1_700_000_000_000;

const run = (
  state: LinkState,
  peerState: string | null,
  iceState: string | null,
  now: number,
  networkKey?: string | null,
) => advanceLink(state, { peerState, iceState, now, networkKey });

/** The state machine as the screen drives it: observe, then apply the effect. */
const tick = (
  state: LinkState,
  peerState: string | null,
  iceState: string | null,
  now: number,
  networkKey?: string | null,
) => {
  const { state: next, effect } = advanceLink(state, {
    peerState,
    iceState,
    now,
    networkKey,
  });
  return { state: next, effect };
};

/** Arm, connect, and settle: a call that is genuinely up. */
const connectedCall = () => {
  const armed = initialLinkState(T0);
  const connecting = tick(armed, 'connecting', 'checking', T0 + 1000);
  return tick(connecting.state, 'connected', 'connected', T0 + 2000);
};

describe('the establishing deadline only governs establishing', () => {
  it('does not tear down a working call ten minutes after the clock was armed', () => {
    const up = connectedCall();
    expect(up.state.phase).toBe('connected');

    // Ten minutes of a live call. Nothing expires.
    let state = up.state;
    for (let elapsed = 3000; elapsed <= 600_000; elapsed += 1000) {
      const step = tick(state, 'connected', 'connected', T0 + elapsed);
      expect(step.effect).toEqual({ type: 'none' });
      state = step.state;
    }
    expect(state.phase).toBe('connected');
  });

  it('gives a working call a recovery window instead of a hangup when it drops', () => {
    const up = connectedCall();

    // The handover. This is the moment the old code ended the call.
    const dropped = tick(up.state, 'disconnected', 'disconnected', T0 + 600_000);
    expect(dropped.state.phase).toBe('recovering');
    expect(dropped.effect.type).not.toBe('hangUp');

    // And the window is measured from the drop, not from `active`.
    const almostOver = tick(
      dropped.state,
      'disconnected',
      'disconnected',
      T0 + 600_000 + RECOVERY_WINDOW_MS - 1,
    );
    expect(almostOver.effect).toEqual({ type: 'none' });
    expect(almostOver.state.phase).toBe('recovering');
  });

  it('survives ICE failing on a call that was working', () => {
    const up = connectedCall();
    const failed = tick(up.state, 'failed', 'failed', T0 + 30_000);
    expect(failed.state.phase).toBe('recovering');
    expect(failed.effect.type).not.toBe('hangUp');
  });

  it('still gives up a call that never connected', () => {
    const armed = initialLinkState(T0);
    const result = run(armed, 'connecting', 'checking', T0 + CONNECT_TIMEOUT_MS);
    // Never connected, no recovery budget spent: the first expiry spends it.
    expect(result.effect).toEqual({ type: 'restartIce' });
    expect(result.state.phase).toBe('recovering');
    expect(result.state.everConnected).toBe(false);
  });

  it('does not expire a window that was never armed', () => {
    const result = run(
      initialLinkState(null),
      'new',
      'new',
      T0 + CONNECT_TIMEOUT_MS * 100,
    );
    expect(result.effect).toEqual({ type: 'none' });
    expect(result.state.armedAt).toBeNull();
  });
});

describe('ICE recovery', () => {
  it('attempts a restart when ICE fails, on a call that was working', () => {
    const up = connectedCall();
    const failed = tick(up.state, 'connecting', 'failed', T0 + 5000);
    expect(failed.effect).toEqual({ type: 'restartIce' });
    expect(failed.state.phase).toBe('recovering');
    expect(failed.state.attempts).toBe(1);
  });

  it('attempts a restart when ICE fails, on a call that never connected', () => {
    const armed = initialLinkState(T0);
    const failed = tick(armed, 'connecting', 'failed', T0 + 5000);
    expect(failed.effect).toEqual({ type: 'restartIce' });
  });

  it('attempts a restart when the connection drops without an ICE failure', () => {
    const up = connectedCall();
    const dropped = tick(up.state, 'disconnected', 'disconnected', T0 + 9000);
    expect(dropped.effect).toEqual({ type: 'restartIce' });
  });

  it('does not re-arm the window on every repeated failed tick', () => {
    const up = connectedCall();
    const first = tick(up.state, 'disconnected', 'failed', T0 + 9000);
    let state = first.state;
    const armedAt = state.armedAt!;
    for (let elapsed = 10_000; elapsed <= 9000 + RECOVERY_WINDOW_MS - 1; elapsed += 1000) {
      const step = tick(state, 'disconnected', 'failed', T0 + elapsed);
      expect(step.effect).toEqual({ type: 'none' });
      state = step.state;
    }
    // Re-arming on every event is what made the original deadline unable to
    // expire at all.
    expect(state.armedAt).toBe(armedAt);
  });

  it('a recovered call never shows a failure message', () => {
    expect(
      connectionStatusLabel({
        notice: null,
        callStatus: 'active',
        role: 'caller',
        peerState: 'disconnected',
        iceState: 'failed',
        linkPhase: 'recovering',
        elapsedLabel: '09:58',
      }),
    ).toBe('Reconnecting…');
  });

  it('knows when a restart is even possible on this peer connection', () => {
    const offerable = {
      restartIce: () => undefined,
      signalingState: 'stable',
      remoteDescription: { type: 'answer' },
    };
    expect(canRestartIce(offerable)).toBe(true);

    // No remote description: libwebrtc refuses an ICE restart, so offering one
    // would throw and the attempt would be spent for nothing.
    expect(canRestartIce({ ...offerable, remoteDescription: null })).toBe(false);
    // A local offer is still in flight: a second offer here is glare.
    expect(
      canRestartIce({ ...offerable, signalingState: 'have-local-offer' }),
    ).toBe(false);
    // Not this library.
    expect(canRestartIce({ signalingState: 'stable', remoteDescription: {} })).toBe(
      false,
    );
    expect(canRestartIce(null)).toBe(false);
  });
});

describe('giving up', () => {
  const countEffects = (effects: LinkEffect[], type: LinkEffect['type']) =>
    effects.filter(effect => effect.type === type).length;

  /**
   * A call that drops and stays dropped, ticked once a second, until the
   * lifecycle gives up or the tick budget runs out.
   */
  const dropAndTick = (from: LinkState, startAt: number) => {
    const effects: LinkEffect[] = [];
    let state = from;
    let now = startAt;
    const first = tick(state, 'disconnected', 'failed', now);
    effects.push(first.effect);
    state = first.state;
    for (let second = 1; second <= 60; second += 1) {
      if (state.phase === 'failed') {
        break;
      }
      now += 1000;
      const step = tick(state, 'disconnected', 'failed', now);
      effects.push(step.effect);
      state = step.state;
    }
    return { state, effects, now };
  };

  it('hangs up exactly once, after a bounded number of restarts', () => {
    const { state, effects } = dropAndTick(connectedCall().state, T0 + 30_000);

    expect(state.phase).toBe('failed');
    expect(countEffects(effects, 'restartIce')).toBe(MAX_RECOVERY_ATTEMPTS);
    expect(countEffects(effects, 'hangUp')).toBe(1);
  });

  it('answers the same question again without hanging up twice', () => {
    const { state } = dropAndTick(connectedCall().state, T0 + 30_000);
    expect(state.phase).toBe('failed');

    const later: LinkEffect[] = [];
    for (let second = 1; second <= 60; second += 1) {
      later.push(tick(state, 'disconnected', 'failed', T0 + 60_000 + second * 1000).effect);
    }
    expect(countEffects(later, 'hangUp')).toBe(0);
    expect(countEffects(later, 'restartIce')).toBe(0);
  });

  it('says one reason, and it is not "Connection failed" on a call that was up', () => {
    const { state, effects } = dropAndTick(connectedCall().state, T0 + 30_000);
    expect(state.phase).toBe('failed');
    const hangUps = effects.filter(effect => effect.type === 'hangUp');
    expect(hangUps).toEqual([
      { type: 'hangUp', reason: 'Call lost · could not reconnect' },
    ]);
  });

  it('gives a working call more grace than the one window it lost', () => {
    const { effects, now } = dropAndTick(connectedCall().state, T0 + 30_000);
    // 20s per attempt, so the call is not dead before the second attempt has had
    // a fair run.
    expect(now).toBeGreaterThanOrEqual(T0 + 30_000 + RECOVERY_WINDOW_MS * 2);
    expect(countEffects(effects, 'restartIce')).toBe(MAX_RECOVERY_ATTEMPTS);
  });

  it('says "Connection failed" only for a call that never carried media', () => {
    const { state, effects } = dropAndTick(
      initialLinkState(T0),
      T0,
    );
    expect(state.phase).toBe('failed');
    expect(state.everConnected).toBe(false);
    expect(effects.filter(effect => effect.type === 'hangUp')).toEqual([
      { type: 'hangUp', reason: 'Connection failed' },
    ]);
  });

  it('never reports the peer twice, because the decision happens once', () => {
    // `closed` is the peer connection being torn down rather than a network
    // problem; it ends the call once and stays ended.
    const closed = run(connectedCall().state, 'closed', 'closed', T0 + 600_000);
    expect(closed.effect).toEqual({
      type: 'hangUp',
      reason: 'Call lost · could not reconnect',
    });
    expect(run(closed.state, 'closed', 'closed', T0 + 601_000).effect).toEqual({
      type: 'none',
    });
  });

  it('a call that recovered gets a full window again, and is not re-armed while up', () => {
    const up = connectedCall();
    const dropped = tick(up.state, 'disconnected', 'disconnected', T0 + 60_000);
    const back = tick(
      dropped.state,
      'connected',
      'connected',
      T0 + 60_000 + 3000,
    );
    expect(back.state.phase).toBe('connected');
    // The outage budget is spent by recovery, not carried forward, so an hour
    // later one more blip is still recoverable.
    expect(back.state.attempts).toBe(0);
    expect(back.state.armedAt).toBeNull();
    expect(back.state.everConnected).toBe(true);
  });
});

/**
 * A handover. `ConnectivityManager` knows the instant the default network is
 * replaced, which matters because this `react-native-webrtc` gathers candidates
 * once: after a Wi-Fi -> LTE swap every candidate both sides hold describes an
 * interface that no longer exists, and libwebrtc's own answer takes a full
 * consent-freshness window - tens of seconds of silence - before it reports
 * `disconnected` and starts the same recovery anyway.
 */
describe('a network handover', () => {
  it('spends a recovery attempt on the first observation of the call network', () => {
    const up = connectedCall();
    // The baseline: this is the network the candidates were just gathered on, so
    // restarting here would be a blip for nothing.
    const baseline = tick(up.state, 'connected', 'connected', T0 + 30_000, 'net-a');
    expect(baseline.effect).toEqual({ type: 'none' });
    expect(baseline.state.phase).toBe('connected');

    // The handover. Worth a restart while the peer connection is still reporting
    // the path it had a moment ago.
    const handover = tick(
      baseline.state,
      'connected',
      'connected',
      T0 + 60_000,
      'net-b',
    );
    expect(handover.effect).toEqual({ type: 'restartIce' });
    expect(handover.state.phase).toBe('recovering');
    expect(handover.state.attempts).toBe(1);
    // Measured from the handover, not from when the call started.
    expect(handover.state.armedAt).toBe(T0 + 60_000);
  });

  it('is a one-shot, not a per-tick restart', () => {
    const up = connectedCall();
    const baseline = tick(up.state, 'connected', 'connected', T0 + 30_000, 'net-a');
    const handover = tick(baseline.state, 'connected', 'connected', T0 + 31_000, 'net-b');
    // What actually happens after a restart offer: the connection goes back to
    // re-checking while the new candidates come in.
    let state = tick(handover.state, 'connecting', 'checking', T0 + 31_500, 'net-b').state;
    for (let elapsed = 32_000; elapsed <= 31_000 + RECOVERY_WINDOW_MS - 1000; elapsed += 1000) {
      const step = tick(state, 'connecting', 'checking', T0 + elapsed, 'net-b');
      // Same network every time, and still inside the window.
      expect(step.effect).toEqual({ type: 'none' });
      state = step.state;
    }
    expect(state.attempts).toBe(1);
  });

  it('does not fire on a repeat of the network already in force', () => {
    const up = connectedCall();
    let state = tick(up.state, 'connected', 'connected', T0 + 30_000, 'net-a').state;
    // `onCapabilitiesChanged` and liveness re-report the same network constantly.
    for (let second = 1; second <= 20; second += 1) {
      const step = tick(state, 'connected', 'connected', T0 + 30_000 + second * 1000, 'net-a');
      expect(step.effect).toEqual({ type: 'none' });
      state = step.state;
    }
    expect(state.attempts).toBe(0);
  });

  it('treats "no network at all" as a change, unlike "no news"', () => {
    const up = connectedCall();
    const baseline = tick(up.state, 'connected', 'connected', T0 + 30_000, 'net-a').state;

    // Omitting the key entirely is the screen having nothing to report, and must
    // not be read as "offline".
    const noNews = tick(baseline, 'connected', 'connected', T0 + 40_000);
    expect(noNews.effect).toEqual({ type: 'none' });
    expect(noNews.state.networkObserved).toBe(true);

    // An explicit null is real news: the device just lost its network.
    const offline = tick(noNews.state, 'connected', 'connected', T0 + 41_000, null);
    expect(offline.effect).toEqual({ type: 'restartIce' });
    expect(offline.state.networkKey).toBeNull();
  });

  it('recovers a call that is still establishing', () => {
    const armed = initialLinkState(T0);
    const baseline = tick(armed, 'connecting', 'checking', T0 + 1000, 'net-a');
    expect(baseline.effect).toEqual({ type: 'none' });
    // Mid-handshake, the candidates just gathered are the ones that just died.
    const handover = tick(baseline.state, 'connecting', 'checking', T0 + 2000, 'net-b');
    expect(handover.effect).toEqual({ type: 'restartIce' });
    expect(handover.state.everConnected).toBe(false);
  });

  it('is bounded by the same budget, and a spent one still hangs up exactly once', () => {
    const up = connectedCall();
    let state = tick(up.state, 'connected', 'connected', T0, 'net-a').state;
    const effects: LinkEffect[] = [];
    // Networks arriving faster than the ladder can be spent.
    for (let index = 0; index < 6; index += 1) {
      const step = tick(
        state,
        'disconnected',
        'failed',
        T0 + (index + 1) * 1000,
        `net-${index}`,
      );
      effects.push(step.effect);
      state = step.state;
    }
    expect(
      effects.filter(effect => effect.type === 'restartIce').length,
    ).toBe(MAX_RECOVERY_ATTEMPTS);
    expect(effects.filter(effect => effect.type === 'hangUp')).toEqual([
      { type: 'hangUp', reason: 'Call lost · could not reconnect' },
    ]);
    // Once ended, a further handover changes nothing and hangs up nobody.
    const after = tick(state, 'disconnected', 'failed', T0 + 900_000, 'net-99');
    expect(after.effect).toEqual({ type: 'none' });
  });

  it('clears the network baseline when a new call arms its own', () => {
    const up = connectedCall();
    const onNetA = tick(up.state, 'connected', 'connected', T0, 'net-a').state;
    expect(onNetA.networkObserved).toBe(true);
    // A second call starts on the same Wi-Fi. The fresh state must not read that
    // as a handover and spend a restart on freshly gathered candidates.
    const fresh = initialLinkState(T0 + 60_000);
    const first = tick(fresh, 'connecting', 'checking', T0 + 60_000, 'net-a');
    expect(first.effect).toEqual({ type: 'none' });
  });
});